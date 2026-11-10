import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { RequestMetaInfo } from '../../common/decorators/auth.decorators';
import { LEGAL_TEMPLATES, type LegalTemplate } from './legal.templates';

export const TERMS_NOT_ACCEPTED = 'TERMS_NOT_ACCEPTED';

type Audience = LegalTemplate['audience'];
const AUDIENCE = new Map(LEGAL_TEMPLATES.map((t) => [t.slug, t.audience]));
export const audienceOf = (slug: string): Audience => AUDIENCE.get(slug) ?? 'everyone';

/** What a person has agreed to. Every acceptance and every marketing change is a new, unchangeable record. */
@Injectable()
export class ConsentService {
  constructor(private readonly prisma: PrismaService) {}

  /** The current published version of each document that must be accepted. */
  private current() {
    return this.prisma.legalDocument.findMany({
      where: { status: 'PUBLISHED', requiresAcceptance: true },
      select: { slug: true, version: true, title: true, changeSummary: true, effectiveAt: true },
    });
  }

  /** The latest decision per document for one person. */
  private async latest(userId: string): Promise<Map<string, { version: number | null; granted: boolean; at: Date }>> {
    const rows = await this.prisma.$queryRaw<Array<{ subject: string; version: number | null; granted: boolean; createdAt: Date }>>`
      SELECT DISTINCT ON (subject) subject, version, granted, "createdAt"
      FROM "ConsentRecord" WHERE "userId" = ${userId}::uuid
      ORDER BY subject, "createdAt" DESC, id DESC`;
    return new Map(rows.map((r) => [r.subject, { version: r.version, granted: r.granted, at: r.createdAt }]));
  }

  /** Which audiences this person belongs to beyond "everyone": a service partner, a seller. */
  private async audiences(userId: string): Promise<Set<Audience>> {
    const [partner, vendor] = await Promise.all([
      this.prisma.servicePartner.count({ where: { userId } }),
      this.prisma.vendor.count({ where: { userId } }),
    ]);
    const out = new Set<Audience>(['everyone']);
    if (partner) out.add('partners');
    if (vendor) out.add('sellers');
    return out;
  }

  /**
   * Documents and marketing choice for the person, with what they still need to accept. Contest terms are asked for
   * when they enter a contest, so they are listed but never "pending" here.
   */
  async status(userId: string) {
    const [docs, latest, audiences, user] = await Promise.all([
      this.current(),
      this.latest(userId),
      this.audiences(userId),
      this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { marketingConsent: true } }),
    ]);
    const documents = docs
      .sort((a, b) => order(a.slug) - order(b.slug))
      .map((d) => {
        const l = latest.get(d.slug);
        const acceptedVersion = l?.granted ? l.version : null;
        const applies = audiences.has(audienceOf(d.slug));
        return {
          slug: d.slug,
          title: d.title,
          version: d.version,
          changeSummary: d.changeSummary,
          effectiveAt: d.effectiveAt,
          audience: audienceOf(d.slug),
          acceptedVersion,
          acceptedAt: l?.granted ? l.at : null,
          pending: applies && acceptedVersion !== d.version,
          /** Accepted an earlier version: show "updated" wording and the change summary. */
          updated: applies && acceptedVersion !== null && acceptedVersion !== d.version,
        };
      });
    const m = latest.get('marketing');
    return {
      documents,
      pending: documents.filter((d) => d.pending).map((d) => d.slug),
      marketing: { granted: user.marketingConsent, changedAt: m?.at ?? null },
    };
  }

  /** Accept the current version of a document. Only the version people can actually read counts. */
  async accept(userId: string, slug: string, version: number, meta: RequestMetaInfo) {
    const doc = await this.prisma.legalDocument.findFirst({ where: { slug, status: 'PUBLISHED' } });
    if (!doc) throw new NotFoundException('Document not found.');
    if (doc.version !== version) throw new BadRequestException(`${doc.title} has been updated. Please read the latest version and accept it again.`);
    const l = (await this.latest(userId)).get(slug);
    if (!(l?.granted && l.version === version)) {
      await this.prisma.consentRecord.create({
        data: { userId, kind: 'DOCUMENT', subject: slug, version, granted: true, ipAddress: meta.ip, userAgent: meta.userAgent?.slice(0, 500) },
      });
    }
    return this.status(userId);
  }

  /** Turn marketing messages on or off. Recorded each time it changes. */
  async setMarketing(userId: string, granted: boolean, meta: RequestMetaInfo) {
    await this.prisma.$transaction(async (tx) => {
      const u = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { marketingConsent: true } });
      if (u.marketingConsent === granted) return;
      await tx.user.update({ where: { id: userId }, data: { marketingConsent: granted } });
      await tx.consentRecord.create({
        data: { userId, kind: 'MARKETING', subject: 'marketing', granted, ipAddress: meta.ip, userAgent: meta.userAgent?.slice(0, 500) },
      });
    });
    return this.status(userId);
  }

  /** Full history, newest first (shown in the data export and to support staff). */
  history(userId: string) {
    return this.prisma.consentRecord.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: { kind: true, subject: true, version: true, granted: true, createdAt: true },
    });
  }

  /**
   * Stops an action until the person has accepted the current version of a document, when one is published and
   * must be accepted. The error carries the code and slug so the apps can show the document and ask.
   */
  async require(userId: string, slug: string): Promise<void> {
    const doc = await this.prisma.legalDocument.findFirst({ where: { slug, status: 'PUBLISHED', requiresAcceptance: true }, select: { version: true, title: true } });
    if (!doc) return;
    const l = (await this.latest(userId)).get(slug);
    if (l?.granted && l.version === doc.version) return;
    throw new ForbiddenException({
      message: `Please read and accept the ${doc.title} first.`,
      errors: [{ code: TERMS_NOT_ACCEPTED, field: slug, message: `Accept version ${doc.version} of the ${doc.title}.` }],
    });
  }
}

export const order = (slug: string) => {
  const i = LEGAL_TEMPLATES.findIndex((t) => t.slug === slug);
  return i < 0 ? 99 : i;
};
