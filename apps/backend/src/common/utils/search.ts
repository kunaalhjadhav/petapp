/**
 * Prisma's `contains` becomes SQL LIKE '%…%' without escaping, so a search for "%" or "_" would match everything.
 * Escape LIKE's wildcards (and its escape character) so what people type is searched for literally.
 */
export const likeText = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
