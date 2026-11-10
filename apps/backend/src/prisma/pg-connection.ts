/**
 * Managed PostgreSQL services (DigitalOcean, AWS RDS, Azure, Aiven…) sign their TLS certificates with their own
 * certificate authority. Node's Postgres driver treats `sslmode=require` as full verification against the public
 * CAs, so it refuses those servers. With DATABASE_CA_CERT set to the provider's CA certificate, connections are
 * fully verified against it instead (hostname included). Without it, the URL is used as it is.
 */

/** A CA certificate as PEM: given as PEM text (newlines or "\n"), or as base64 of the PEM file. */
export function pemCertificate(raw: string | undefined | null, setting: string): string | undefined {
  const t = raw?.trim();
  if (!t) return undefined;
  const pem = (t.includes('-----BEGIN') ? t.replace(/\\n/g, '\n') : Buffer.from(t, 'base64').toString('utf8')).trim();
  if (!pem.includes('-----BEGIN CERTIFICATE-----')) throw new Error(`${setting} is not a PEM certificate (paste the file, or its base64)`);
  return pem;
}

export const pgCaCert = (raw: string | undefined | null) => pemCertificate(raw, 'DATABASE_CA_CERT');

/** ioredis options for a managed Redis/Valkey whose certificate is signed by the provider's own CA (REDIS_CA_CERT). */
export function redisTls(raw: string | undefined | null): { tls?: { ca: string } } {
  const ca = pemCertificate(raw, 'REDIS_CA_CERT');
  return ca ? { tls: { ca } } : {};
}

const TLS_PARAMS = ['sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'uselibpqcompat', 'sslaccept'];

/** Options for node-postgres / PrismaPg. The URL's own TLS settings are dropped when a CA is given (they'd override it). */
export function pgConnection(url: string, caRaw?: string | null): { connectionString: string; ssl?: { ca: string; rejectUnauthorized: true } } {
  const ca = pgCaCert(caRaw);
  if (!ca) return { connectionString: url };
  const u = new URL(url);
  for (const k of TLS_PARAMS) u.searchParams.delete(k);
  return { connectionString: u.toString(), ssl: { ca, rejectUnauthorized: true } };
}
