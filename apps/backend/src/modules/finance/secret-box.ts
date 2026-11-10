import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

/**
 * AES-256-GCM for small secrets at rest (bank account numbers). Format: "v1:<iv>:<tag>:<ciphertext>", base64 parts.
 * The key comes from PAYOUT_DATA_KEY (32 bytes, base64; required in staging/production). Development without it
 * uses a fixed, clearly-not-secret key so local data stays readable.
 */
export class SecretBox {
  private readonly key: Buffer;
  readonly usingDevKey: boolean;

  /** `name` is the setting the key comes from (PAYOUT_DATA_KEY, MFA_DATA_KEY), for messages and the dev key. */
  constructor(base64Key: string | undefined, name = 'PAYOUT_DATA_KEY') {
    this.usingDevKey = !base64Key;
    const devSeed = name === 'PAYOUT_DATA_KEY' ? 'petapp-development-only-payout-key' : `petapp-development-only-${name}`;
    this.key = base64Key ? Buffer.from(base64Key, 'base64') : createHash('sha256').update(devSeed).digest();
    if (this.key.length !== 32) throw new Error(`${name} must be 32 bytes (base64)`);
  }

  seal(plain: string): string {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.key, iv);
    const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
    return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), enc.toString('base64')].join(':');
  }

  open(sealed: string): string {
    const [v, iv, tag, enc] = sealed.split(':');
    if (v !== 'v1' || !iv || !tag || !enc) throw new Error('not a sealed value');
    const d = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64'));
    d.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(enc, 'base64')), d.final()]).toString('utf8');
  }
}
