import { randomBytes } from 'crypto';

export function slugify(v: string): string {
  return v
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 24);
}

/** Public pet handle, e.g. "bruno.3fa9c1". */
export function handleCandidate(name: string): string {
  const base = slugify(name) || 'pet';
  return `${base}.${randomBytes(3).toString('hex')}`;
}
