import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { RequestMetaInfo } from '../../common/decorators/auth.decorators';
import { LEGAL_TEMPLATES, PLACEHOLDER } from './legal.templates';
import { audienceOf, order } from './consent.service';
import type { PublishLegalDto, UpdateLegalDto } from './privacy.dto';

const SUMMARY = { id: true, slug: true, version: true, title: true, status: true, requiresAcceptance: true, changeSummary: true, effectiveAt: true, publishedAt: true, updatedAt: true } as const;

/** Legal documents: public reading, and versioned drafts that staff edit and publish. */
@Injectable()
export class LegalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Makes sure every document exists, as a first draft from the template. Never touches existing documents. */
  async ensureTemplates(): Promise<number> {
    const have = new Set((await this.prisma.legalDocument.findMany({ distinct: ['slug'], select: { slug: true } })).map((d) => d.slug));
    const missing = LEGAL_TEMPLATES.filter((t) => !have.has(t.slug));
    if (missing.length) {
      await this.prisma.legalDocument.createMany({
        data: missing.map((t) => ({ slug: t.slug, version: 1, title: t.title, body: t.body, requiresAcceptance: t.requiresAcceptance, changeSummary: 'First version' })),
        skipDuplicates: true,
      });
    }
    return missing.length;
  }

  // ── public ──

  async list() {
    const docs = await this.prisma.legalDocument.findMany({ where: { status: 'PUBLISHED' }, select: { slug: true, title: true, version: true, effectiveAt: true, publishedAt: true, requiresAcceptance: true } });
    return docs.sort((a, b) => order(a.slug) - order(b.slug)).map((d) => ({ ...d, audience: audienceOf(d.slug) }));
  }

  async read(slug: string) {
    const d = await this.prisma.legalDocument.findFirst({
      where: { slug, status: 'PUBLISHED' },
      select: { slug: true, title: true, version: true, body: true, changeSummary: true, effectiveAt: true, publishedAt: true, requiresAcceptance: true },
    });
    if (!d) throw new NotFoundException('Document not found.');
    return { ...d, audience: audienceOf(d.slug) };
  }

  // ── admin ──

  /** One row per document: the version people see now, the draft being worked on, and how many accepted it. */
  async adminList() {
    await this.ensureTemplates();
    const [docs, counts] = await Promise.all([
      this.prisma.legalDocument.findMany({ select: { ...SUMMARY, body: true }, orderBy: { version: 'desc' } }),
      this.prisma.consentRecord.groupBy({ by: ['subject', 'version'], where: { kind: 'DOCUMENT', granted: true }, _count: { _all: true } }),
    ]);
    // Count people, not clicks: one acceptance per person per version is recorded, so rows = people.
    const accepted = new Map(counts.map((c) => [`${c.subject}:${c.version}`, c._count._all]));
    const slugs = [...new Set(docs.map((d) => d.slug))].sort((a, b) => order(a) - order(b));
    return slugs.map((slug) => {
      const versions = docs.filter((d) => d.slug === slug);
      const pub = versions.find((d) => d.status === 'PUBLISHED');
      const dr = versions.find((d) => d.status === 'DRAFT');
      const current = pub ? strip(pub) : null;
      const draft = dr ? strip(dr) : null;
      const latest = versions[0];
      return {
        slug,
        title: (current ?? latest).title,
        audience: audienceOf(slug),
        current: current && { ...current, acceptances: accepted.get(`${slug}:${current.version}`) ?? 0 },
        draft: draft && dr && { ...draft, placeholders: placeholders(dr.body).length },
        versions: versions.length,
      };
    });
  }

  async adminOne(id: string) {
    const d = await this.prisma.legalDocument.findUnique({ where: { id } });
    if (!d) throw new NotFoundException('Document not found.');
    const [history, acceptances] = await Promise.all([
      this.prisma.legalDocument.findMany({ where: { slug: d.slug }, select: SUMMARY, orderBy: { version: 'desc' } }),
      this.prisma.consentRecord.count({ where: { kind: 'DOCUMENT', subject: d.slug, version: d.version, granted: true } }),
    ]);
    return { ...d, audience: audienceOf(d.slug), placeholders: placeholders(d.body), acceptances, history };
  }

  /** Starts a new version from the latest one. One draft per document at a time. */
  async createDraft(slug: string, actorId: string, meta: RequestMetaInfo) {
    await this.ensureTemplates();
    const latest = await this.prisma.legalDocument.findFirst({ where: { slug }, orderBy: { version: 'desc' } });
    if (!latest) throw new NotFoundException('Document not found.');
    if (latest.status === 'DRAFT') throw new ConflictException('This document already has a draft. Edit that one.');
    const d = await this.prisma.$transaction(async (tx) => {
      const created = await tx.legalDocument.create({
        data: { slug, version: latest.version + 1, title: latest.title, body: latest.body, requiresAcceptance: latest.requiresAcceptance, createdById: actorId },
      });
      await this.audit.log({ actorId, action: 'legal.draft', entityType: 'LegalDocument', entityId: created.id, after: { slug, version: created.version }, meta }, tx);
      return created;
    });
    return this.adminOne(d.id);
  }

  async updateDraft(id: string, dto: UpdateLegalDto) {
    const d = await this.draft(id);
    await this.prisma.legalDocument.update({ where: { id: d.id }, data: dto });
    return this.adminOne(id);
  }

  async deleteDraft(id: string, actorId: string, meta: RequestMetaInfo) {
    const d = await this.draft(id);
    if (d.version === 1) throw new BadRequestException('The first version can’t be deleted. Edit it instead.');
    await this.prisma.$transaction(async (tx) => {
      await tx.legalDocument.delete({ where: { id } });
      await this.audit.log({ actorId, action: 'legal.draft_delete', entityType: 'LegalDocument', entityId: id, before: { slug: d.slug, version: d.version }, meta }, tx);
    });
  }

  /**
   * Makes a draft the current version. The previous version is retired; if acceptance is required, everyone is asked
   * to accept the new version (they keep their record of accepting the old one).
   */
  async publish(id: string, dto: PublishLegalDto, actorId: string, meta: RequestMetaInfo) {
    const d = await this.draft(id);
    const left = placeholders(d.body);
    if (left.length) {
      throw new BadRequestException({
        message: 'Fill in every {{placeholder}} before publishing.',
        errors: left.map((p) => ({ field: 'body', message: `Still to fill in: ${p}` })),
      });
    }
    if (d.version > 1 && !d.changeSummary?.trim()) throw new BadRequestException('Say what changed in this version. People see it when asked to accept again.');
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      // Lock the document's rows so two people publishing at once can't both win.
      await tx.$queryRaw`SELECT id FROM "LegalDocument" WHERE slug = ${d.slug} FOR UPDATE`;
      const prev = await tx.legalDocument.findFirst({ where: { slug: d.slug, status: 'PUBLISHED' } });
      if (prev) await tx.legalDocument.update({ where: { id: prev.id }, data: { status: 'RETIRED' } });
      await tx.legalDocument.update({
        where: { id: d.id },
        data: { status: 'PUBLISHED', publishedAt: now, publishedById: actorId, effectiveAt: dto.effectiveAt ? new Date(dto.effectiveAt) : now },
      });
      await this.audit.log({
        actorId, action: 'legal.publish', entityType: 'LegalDocument', entityId: d.id,
        before: prev ? { version: prev.version } : undefined,
        after: { slug: d.slug, version: d.version, requiresAcceptance: d.requiresAcceptance },
        meta,
      }, tx);
    });
    return this.adminOne(id);
  }

  private async draft(id: string) {
    const d = await this.prisma.legalDocument.findUnique({ where: { id } });
    if (!d) throw new NotFoundException('Document not found.');
    if (d.status !== 'DRAFT') throw new BadRequestException('Published versions can’t be changed. Start a new version.');
    return d;
  }
}

const strip = <T extends { body: string }>({ body: _b, ...rest }: T) => rest;

/** The distinct {{placeholders}} still in a text. */
export function placeholders(body: string): string[] {
  return [...new Set(body.match(new RegExp(PLACEHOLDER.source, 'g')) ?? [])];
}
