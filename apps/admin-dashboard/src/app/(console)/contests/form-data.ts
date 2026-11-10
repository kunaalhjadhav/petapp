import 'server-only';
import { api, apiPage } from '@/lib/api';
import type { ContestCategory, Species, UserRow } from '@/lib/types';

/** Lookups the builder needs: categories, judges (users with the Judge role) and species. */
export async function builderData() {
  const [categories, judges, species] = await Promise.all([
    api<ContestCategory[]>('/admin/contest-categories'),
    apiPage<UserRow>('/admin/users', { role: 'JUDGE', status: 'ACTIVE', limit: 100 }),
    api<Species[]>('/species'),
  ]);
  return {
    categories: categories.filter((c) => c.isActive),
    judges: judges.items.map((u) => ({ id: u.id, name: u.name })),
    species,
  };
}
