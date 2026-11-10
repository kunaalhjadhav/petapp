import { pgCaCert, pgConnection, redisTls } from './pg-connection';

const PEM = '-----BEGIN CERTIFICATE-----\nMIIBszCCAVmgAwIBAgIU\n-----END CERTIFICATE-----\n';

describe('database TLS', () => {
  it('uses the URL as it is without a CA', () => {
    expect(pgConnection('postgresql://u:p@db:5432/x?sslmode=require')).toEqual({ connectionString: 'postgresql://u:p@db:5432/x?sslmode=require' });
    expect(pgCaCert('')).toBeUndefined();
  });
  it('verifies against the provider CA, given as PEM, escaped PEM or base64', () => {
    for (const raw of [PEM, PEM.replace(/\n/g, '\\n'), Buffer.from(PEM).toString('base64')]) {
      const c = pgConnection('postgresql://u:p@db.example:25060/petapp?sslmode=require&uselibpqcompat=true&sslaccept=accept_invalid_certs&connection_limit=5', raw);
      expect(c.ssl).toEqual({ ca: PEM.trim(), rejectUnauthorized: true });
      expect(c.connectionString).toBe('postgresql://u:p@db.example:25060/petapp?connection_limit=5');
    }
  });
  it('refuses something that is not a certificate', () => {
    expect(() => pgCaCert('aGVsbG8=')).toThrow(/not a PEM certificate/);
  });
  it('gives Redis the provider CA when set', () => {
    expect(redisTls(undefined)).toEqual({});
    expect(redisTls(Buffer.from(PEM).toString('base64'))).toEqual({ tls: { ca: PEM.trim() } });
    expect(() => redisTls('nope')).toThrow(/REDIS_CA_CERT/);
  });
});
