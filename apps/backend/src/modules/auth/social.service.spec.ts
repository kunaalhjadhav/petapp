import { createHash } from 'crypto';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { SocialAuthService } from './social.service';

const config = (google: string[], apple: string[]) => ({ get: (k: string) => (k === 'GOOGLE_CLIENT_IDS' ? google : apple) }) as never;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

describe('Google and Apple sign-in checks', () => {
  let apple: SocialAuthService;
  let sign: (claims: Record<string, unknown>, aud?: string, iss?: string) => Promise<string>;

  beforeAll(async () => {
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256' };
    apple = new SocialAuthService(config([], ['com.petapp.petapp']));
    apple.appleKeys = createLocalJWKSet({ keys: [jwk] });
    sign = (claims, aud = 'com.petapp.petapp', iss = 'https://appleid.apple.com') =>
      new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: 'k1' }).setIssuer(iss).setAudience(aud).setIssuedAt().setExpirationTime('5m').sign(privateKey);
  });

  it('Apple: accepts a token for this app whose nonce matches, and reads the email', async () => {
    const t = await sign({ sub: 'apple-001', email: 'X@privaterelay.appleid.com', email_verified: 'true', nonce: sha('n-1234567890abcdef') });
    expect(await apple.verifyApple(t, 'Aanya Kapoor', 'n-1234567890abcdef')).toEqual({ providerUserId: 'apple-001', email: 'x@privaterelay.appleid.com', emailVerified: true, name: 'Aanya Kapoor' });
  });

  it('Apple: refuses a replayed token, another app, another issuer and a missing setup', async () => {
    const t = await sign({ sub: 'apple-001', nonce: sha('n-1234567890abcdef') });
    await expect(apple.verifyApple(t, undefined, 'n-different-0000000')).rejects.toThrow('Apple sign-in failed');
    await expect(apple.verifyApple(await sign({ sub: 'a', nonce: sha('n-1234567890abcdef') }, 'com.other.app'), undefined, 'n-1234567890abcdef')).rejects.toThrow('Apple sign-in failed');
    await expect(apple.verifyApple(await sign({ sub: 'a', nonce: sha('n-1234567890abcdef') }, undefined, 'https://evil.example'), undefined, 'n-1234567890abcdef')).rejects.toThrow('Apple sign-in failed');
    await expect(new SocialAuthService(config([], [])).verifyApple(t, undefined, 'n-1234567890abcdef')).rejects.toThrow('Apple sign-in is not configured');
  });

  it('Google: checks the token against the configured app IDs and reads the profile', async () => {
    const g = new SocialAuthService(config(['web-client.apps.googleusercontent.com'], []));
    const calls: unknown[] = [];
    g.google = { verifyIdToken: async (o: unknown) => (calls.push(o), { getPayload: () => ({ sub: 'g-42', email: 'Aanya@Gmail.com', email_verified: true, name: 'Aanya', picture: 'https://p/x.jpg' }) }) } as never;
    expect(await g.verifyGoogle('tok')).toEqual({ providerUserId: 'g-42', email: 'aanya@gmail.com', emailVerified: true, name: 'Aanya', avatarUrl: 'https://p/x.jpg' });
    expect(calls).toEqual([{ idToken: 'tok', audience: ['web-client.apps.googleusercontent.com'] }]);
    g.google = { verifyIdToken: async () => { throw new Error('Wrong recipient'); } } as never;
    await expect(g.verifyGoogle('tok')).rejects.toThrow('Google sign-in failed');
    await expect(new SocialAuthService(config([], [])).verifyGoogle('tok')).rejects.toThrow('Google sign-in is not configured');
  });
});
