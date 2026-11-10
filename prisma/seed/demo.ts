import type { PrismaClient } from '../../apps/backend/src/generated/prisma/client';

/**
 * Fictional demo data for development. Phone numbers use the +91 90000 000xx block and
 * emails use example.com so they can never reach real people.
 */
const USERS = [
  { phone: '+919000000001', name: 'Aanya Kapoor', city: 'Mumbai', role: 'CUSTOMER' },
  { phone: '+919000000002', name: 'Kabir Mehta', city: 'Pune', role: 'CUSTOMER' },
  { phone: '+919000000003', name: 'Riya Sharma', city: 'Delhi', role: 'CUSTOMER' },
  { phone: '+919000000004', name: 'Dr. Arjun Rao', city: 'Mumbai', role: 'JUDGE' },
  { phone: '+919000000005', name: 'Pawfect Grooming Spa', city: 'Mumbai', role: 'SERVICE_PARTNER' },
  { phone: '+919000000006', name: 'Happy Tails Foods', city: 'Pune', role: 'PRODUCT_PARTNER' },
] as const;

const PETS = [
  { owner: 0, name: 'Bruno', species: 'dog', breed: 'Golden Retriever', gender: 'MALE', dob: '2023-08-14', weight: 31, about: 'Beach walks, tennis balls and belly rubs.', personality: ['playful', 'gentle'] },
  { owner: 0, name: 'Mishti', species: 'cat', breed: 'Persian', gender: 'FEMALE', dob: '2022-02-01', weight: 4.2, about: 'Sun-lover and professional napper.', personality: ['calm'] },
  { owner: 0, name: 'Kiwi', species: 'bird', breed: 'Budgerigar', gender: 'UNKNOWN', dob: '2024-05-10', weight: 0.04, about: 'Whistles the doorbell tune.', personality: ['chatty'] },
  { owner: 1, name: 'Luna', species: 'dog', breed: 'Shih Tzu', gender: 'FEMALE', dob: '2021-11-20', weight: 6.5, about: 'Small dog, big opinions.', personality: ['bold'] },
  { owner: 2, name: 'Simba', species: 'cat', breed: 'Persian', gender: 'MALE', dob: '2020-06-03', weight: 5.1, about: 'Fluffiest coat in Delhi, allegedly.', personality: ['proud'] },
  { owner: 2, name: 'Oreo', species: 'dog', breed: 'Indie', gender: 'MALE', dob: '2022-09-12', weight: 18, about: 'Adopted from a local shelter in 2023.', personality: ['loyal', 'energetic'] },
] as const;

export async function seedDemoData(prisma: PrismaClient): Promise<void> {
  const roles = new Map((await prisma.role.findMany()).map((r) => [r.key, r.id]));
  const userIds: string[] = [];
  for (const u of USERS) {
    const user = await prisma.user.upsert({
      where: { phone: u.phone },
      update: {},
      create: {
        phone: u.phone,
        name: u.name,
        city: u.city,
        phoneVerifiedAt: new Date(),
        identities: { create: { provider: 'PHONE', providerUserId: u.phone } },
        roles: { create: [...new Set(['CUSTOMER', u.role])].map((k) => ({ roleId: roles.get(k)! })) },
      },
    });
    userIds.push(user.id);
  }

  for (const p of PETS) {
    const handle = `${p.name.toLowerCase()}.demo`;
    if (await prisma.pet.findUnique({ where: { handle } })) continue;
    const species = await prisma.petSpecies.findUniqueOrThrow({ where: { key: p.species } });
    const breed = await prisma.petBreed.findFirst({ where: { speciesId: species.id, name: p.breed } });
    await prisma.pet.create({
      data: {
        ownerId: userIds[p.owner],
        speciesId: species.id,
        breedId: breed?.id,
        name: p.name,
        handle,
        gender: p.gender,
        dateOfBirth: new Date(p.dob),
        weightKg: p.weight,
        about: p.about,
        personality: [...p.personality],
        city: USERS[p.owner].city,
      },
    });
  }

  // A little social graph so follower counts are non-zero.
  const bruno = await prisma.pet.findUniqueOrThrow({ where: { handle: 'bruno.demo' } });
  for (const follower of [userIds[1], userIds[2]]) {
    const { count } = await prisma.petFollower.createMany({ data: [{ userId: follower, petId: bruno.id }], skipDuplicates: true });
    if (count) await prisma.pet.update({ where: { id: bruno.id }, data: { followerCount: { increment: 1 } } });
  }

  // Services marketplace: categories and one partner waiting for verification (fictional).
  const categories = [
    { key: 'grooming', name: 'Grooming', commissionBps: 1500, sortOrder: 1 },
    { key: 'vet-consultation', name: 'Vet consultation', commissionBps: 1000, sortOrder: 2 },
    { key: 'training', name: 'Training', commissionBps: 1500, sortOrder: 3 },
    { key: 'boarding', name: 'Boarding', commissionBps: 1200, sortOrder: 4 },
    { key: 'walking', name: 'Dog walking', commissionBps: 1500, sortOrder: 5 },
  ];
  for (const c of categories) await prisma.serviceCategory.upsert({ where: { key: c.key }, update: {}, create: c });
  const grooming = await prisma.serviceCategory.findUniqueOrThrow({ where: { key: 'grooming' } });
  const owner = userIds[4];
  if (!(await prisma.servicePartner.findUnique({ where: { userId: owner } }))) {
    const doc = await prisma.mediaAsset.create({
      data: { ownerId: owner, kind: 'DOCUMENT', mimeType: 'application/pdf', sizeBytes: 1024, storageKey: `uploads/${owner}/demo-id-proof.pdf`, status: 'READY', variants: {} },
    });
    const dog = await prisma.petSpecies.findUniqueOrThrow({ where: { key: 'dog' } });
    await prisma.servicePartner.create({
      data: {
        userId: owner, slug: 'pawfect-grooming-spa-demo', businessName: 'Pawfect Grooming Spa', kind: 'BUSINESS',
        about: 'Gentle, fear-free grooming for dogs and cats. (Demo business.)', phone: '+919000000005', email: 'grooming@example.com',
        addressLine: '14 Demo Lane', area: 'Bandra West', city: 'Mumbai', state: 'Maharashtra', pincode: '400050', lat: 19.0596, lng: 72.8295,
        homeVisitRadiusKm: 5, status: 'SUBMITTED', submittedAt: new Date(),
        documents: { create: [{ kind: 'ID_PROOF', mediaId: doc.id }] },
        services: { create: [{ categoryId: grooming.id, name: 'Full groom', description: 'Bath, trim, nails and ears.', durationMin: 60, bufferMin: 15, pricePaise: 79900, modes: ['AT_CENTER', 'AT_HOME'], speciesIds: [dog.id] }] },
        hours: { create: Array.from({ length: 7 }, (_, d) => ({ weekday: d, opensMin: 9 * 60, closesMin: 20 * 60 })) },
      },
    });
  }
}
