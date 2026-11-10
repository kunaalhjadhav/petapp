/* eslint-disable no-console */
import 'dotenv/config';
import * as bcrypt from 'bcryptjs';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../apps/backend/src/generated/prisma/client';
import { syncRbac } from '../../apps/backend/src/modules/rbac/rbac.seed';
import { DEFAULT_FLAGS, DEFAULT_SETTINGS } from '../../apps/backend/src/modules/platform/platform.defaults';
import { LEGAL_TEMPLATES } from '../../apps/backend/src/modules/privacy/legal.templates';
import { SUPPORT_CATEGORIES, SUPPORT_FAQS } from '../../apps/backend/src/modules/chat/support.defaults';
import { seedLocations } from '../../apps/backend/src/modules/locations/locations.seed';
import { seedMembershipPlans } from '../../apps/backend/src/modules/memberships/memberships.seed';
import { SPECIES } from './species';
import { pgConnection } from '../../apps/backend/src/prisma/pg-connection';
import { seedDemoData } from './demo';

const prisma = new PrismaClient({ adapter: new PrismaPg(pgConnection(process.env.DATABASE_URL!, process.env.DATABASE_CA_CERT)) });

async function seedSpecies() {
  for (const [i, s] of SPECIES.entries()) {
    const species = await prisma.petSpecies.upsert({
      where: { key: s.key },
      update: {},
      create: { key: s.key, name: s.name, sortOrder: i },
    });
    await prisma.petBreed.createMany({
      data: s.breeds.map((name) => ({ speciesId: species.id, name })),
      skipDuplicates: true,
    });
  }
}

async function seedPlatform() {
  for (const [key, enabled] of Object.entries(DEFAULT_FLAGS)) {
    await prisma.featureFlag.upsert({ where: { key }, update: {}, create: { key, enabled } });
  }
  for (const [key, s] of Object.entries(DEFAULT_SETTINGS)) {
    await prisma.appSetting.upsert({ where: { key }, update: {}, create: { key, value: s.value, description: s.description } });
  }
}

/**
 * First drafts of the legal documents, from templates that a lawyer must review. Drafts only: nothing is shown to
 * anyone until staff fill in the placeholders and publish. Documents that already exist are left alone.
 */
async function seedLegal() {
  const have = new Set((await prisma.legalDocument.findMany({ distinct: ['slug'], select: { slug: true } })).map((d) => d.slug));
  const missing = LEGAL_TEMPLATES.filter((t) => !have.has(t.slug));
  if (missing.length) {
    await prisma.legalDocument.createMany({
      data: missing.map((t) => ({ slug: t.slug, version: 1, title: t.title, body: t.body, requiresAcceptance: t.requiresAcceptance, changeSummary: 'First version' })),
      skipDuplicates: true,
    });
  }
  return missing.length;
}

/** Support topics (kept as staff edited them) and, the first time only, draft FAQs for staff to review and publish. */
async function seedSupport() {
  for (const c of SUPPORT_CATEGORIES) {
    await prisma.supportCategory.upsert({ where: { key: c.key }, update: {}, create: c });
  }
  if (await prisma.supportFaq.count()) return 0;
  const cats = new Map((await prisma.supportCategory.findMany({ select: { id: true, key: true } })).map((c) => [c.key, c.id]));
  await prisma.supportFaq.createMany({
    data: SUPPORT_FAQS.map((f, i) => ({ question: f.question, answer: f.answer, audience: f.audience, categoryId: cats.get(f.category) ?? null, sortOrder: (i + 1) * 10, published: false })),
  });
  return SUPPORT_FAQS.length;
}

/**
 * Bootstraps the first SUPER_ADMIN from environment variables. Never hard-coded.
 * Skipped when SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD are not set.
 */
async function seedAdmin() {
  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password) {
    console.log('• SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD not set — skipping admin bootstrap');
    return;
  }
  if (password.length < 12) throw new Error('SEED_ADMIN_PASSWORD must be at least 12 characters');
  const role = await prisma.role.findUniqueOrThrow({ where: { key: 'SUPER_ADMIN' } });
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    await prisma.userRole.createMany({ data: [{ userId: existing.id, roleId: role.id }], skipDuplicates: true });
    console.log(`• Admin ${email} already exists — ensured SUPER_ADMIN role (password unchanged)`);
    return;
  }
  const rounds = Number(process.env.BCRYPT_ROUNDS ?? 12);
  await prisma.user.create({
    data: {
      email,
      name: process.env.SEED_ADMIN_NAME ?? 'Super Admin',
      passwordHash: await bcrypt.hash(password, rounds),
      emailVerifiedAt: new Date(),
      roles: { create: { roleId: role.id } },
      identities: { create: { provider: 'EMAIL', providerUserId: email, email } },
    },
  });
  console.log(`• Created SUPER_ADMIN ${email}`);
}

async function main() {
  console.log('Seeding PetApp…');
  await syncRbac(prisma);
  console.log('• Roles and permissions synced');
  await seedSpecies();
  console.log('• Species and breeds');
  await seedPlatform();
  console.log('• Feature flags and settings');
  console.log(`• Legal documents: ${await seedLegal()} new draft(s) — review and publish them in the dashboard`);
  console.log(`• Support topics, and ${await seedSupport()} draft FAQ(s) — review and publish them in the dashboard`);
  console.log(`• Locations: India, its states, and ${await seedLocations(prisma)} new city/cities — add areas and PIN codes in the dashboard`);
  console.log(`• Membership plans: ${await seedMembershipPlans(prisma)} new (memberships stay off until ENABLE_MEMBERSHIPS is on)`);
  await seedAdmin();

  const demo = process.env.SEED_DEMO_DATA === 'true';
  if (demo && process.env.NODE_ENV === 'production') throw new Error('Refusing to seed demo data in production');
  if (demo) {
    await seedDemoData(prisma);
    console.log('• Demo users and pets (fictional)');
  }
  console.log('Done.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
