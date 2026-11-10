import { Client } from 'pg';

const DB =
  process.env.E2E_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5432/petapp';

export async function sql<T = Record<string, unknown>>(
  q: string,
  params: unknown[] = [],
): Promise<T[]> {
  const db = new Client({ connectionString: DB });
  await db.connect();
  try {
    return (await db.query(q, params)).rows as T[];
  } finally {
    await db.end();
  }
}

/** A pet with the given visibility, owned by a fresh user whose name must never appear on the website. */
export async function makePet(visibility: 'PUBLIC' | 'PRIVATE' | 'FOLLOWERS', tag: string) {
  const [species] = await sql<{ id: string }>(`SELECT id FROM "PetSpecies" WHERE key = 'dog'`);
  const [owner] = await sql<{ id: string }>(
    `INSERT INTO "User" (id, name, phone, "createdAt", "updatedAt") VALUES (gen_random_uuid(), $1, $2, now(), now()) RETURNING id`,
    [`Owner Secretname ${tag}`, `+9193${String(Date.now()).slice(-8)}`],
  );
  const handle = `${visibility.toLowerCase()}.${tag}`;
  await sql(
    `INSERT INTO "Pet" (id, "ownerId", "speciesId", name, handle, about, city, visibility, "updatedAt") VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 'Pune', $6, now())`,
    [owner.id, species.id, `Biscuit ${tag}`, handle, 'Loves long walks on Juhu beach.', visibility],
  );
  return handle;
}

/** The first value a query finds, or null when this database has none (the test is then skipped). */
export async function one(q: string): Promise<string | null> {
  const rows = await sql<{ v: string }>(q);
  return rows[0]?.v ?? null;
}
