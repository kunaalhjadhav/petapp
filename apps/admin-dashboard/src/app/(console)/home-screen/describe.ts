import { formatDateTime } from '@/lib/format';
import type { HomeSection, Species } from '@/lib/types';

/** "Everyone", or who the section is limited to. */
export function audience(s: HomeSection, species: Species[]) {
  const parts: string[] = [];
  if (s.cities.length)
    parts.push(s.cities.map((c) => c.replace(/\b\w/g, (x) => x.toUpperCase())).join(', '));
  if (s.speciesIds.length)
    parts.push(
      `${s.speciesIds.map((id) => species.find((x) => x.id === id)?.name ?? 'unknown').join(' or ')} owners`,
    );
  return parts.length ? parts.join(' · ') : 'Everyone';
}

export function schedule(s: HomeSection) {
  if (!s.startsAt && !s.endsAt) return 'Always';
  if (s.startsAt && s.endsAt) return `${formatDateTime(s.startsAt)} to ${formatDateTime(s.endsAt)}`;
  return s.startsAt ? `From ${formatDateTime(s.startsAt)}` : `Until ${formatDateTime(s.endsAt)}`;
}
