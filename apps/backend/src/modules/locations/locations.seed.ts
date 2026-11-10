import type { PrismaClient } from '../../generated/prisma/client';
import { CITIES, COUNTRIES, STATES } from './locations.defaults';
import { placeSlug } from './locations.rules';

/**
 * Adds the starting countries, states and cities. Existing rows are left as staff edited them; returns how many
 * cities were added.
 */
export async function seedLocations(prisma: Pick<PrismaClient, 'country' | 'state' | 'city'>): Promise<number> {
  for (const c of COUNTRIES) await prisma.country.upsert({ where: { code: c.code }, update: {}, create: c });
  const ids = new Map<string, string>();
  for (const s of STATES) {
    const row = await prisma.state.upsert({
      where: { countryCode_code: { countryCode: 'IN', code: s.code } },
      update: {},
      create: { countryCode: 'IN', code: s.code, name: s.name, isUnionTerritory: !!s.ut },
    });
    ids.set(s.code, row.id);
  }
  let added = 0;
  for (const [i, [name, state, lat, lng]] of CITIES.entries()) {
    const slug = placeSlug(name);
    if (await prisma.city.findUnique({ where: { slug }, select: { id: true } })) continue;
    await prisma.city.create({ data: { name, slug, stateId: ids.get(state)!, lat, lng, sortOrder: (i + 1) * 10 } });
    added++;
  }
  return added;
}
