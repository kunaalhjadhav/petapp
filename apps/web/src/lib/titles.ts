import type { Post } from './types';

/** "Bruno’s reel", "A photo of Kiwi and Momo", "A PetApp reel". No person's name: posts are about pets. */
export function postTitle(p: Post): string {
  const names = p.pets.map((x) => x.name);
  const who =
    names.length > 2
      ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
      : names.join(' and ');
  if (p.type === 'REEL')
    return who ? (names.length === 1 ? `${who}’s reel` : `A reel of ${who}`) : 'A PetApp reel';
  return who ? `A photo of ${who}` : 'A PetApp photo';
}
