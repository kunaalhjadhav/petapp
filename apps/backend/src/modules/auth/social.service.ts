import { createHash } from 'crypto';
import { Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { OAuth2Client } from 'google-auth-library';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { AppConfig } from '../../config/app-config.service';

export interface SocialProfile {
  providerUserId: string;
  email?: string;
  emailVerified: boolean;
  name?: string;
  avatarUrl?: string;
}

const APPLE_ISSUER = 'https://appleid.apple.com';

/** Verifies Google / Apple ID tokens server-side. Client-side claims are never trusted. */
@Injectable()
export class SocialAuthService {
  /** Replaced in tests. */
  google = new OAuth2Client();
  appleKeys: JWTVerifyGetKey = createRemoteJWKSet(new URL(`${APPLE_ISSUER}/auth/keys`));

  constructor(private readonly config: AppConfig) {}

  async verifyGoogle(idToken: string): Promise<SocialProfile> {
    const audience = this.config.get('GOOGLE_CLIENT_IDS');
    if (!audience.length) throw new ServiceUnavailableException('Google sign-in is not configured.');
    try {
      const ticket = await this.google.verifyIdToken({ idToken, audience });
      const p = ticket.getPayload();
      if (!p?.sub) throw new Error('no subject');
      return { providerUserId: p.sub, email: p.email?.toLowerCase(), emailVerified: !!p.email_verified, name: p.name, avatarUrl: p.picture };
    } catch {
      throw new UnauthorizedException('Google sign-in failed. Please try again.');
    }
  }

  /**
   * Apple: the app gives Apple the SHA-256 of a random nonce and sends us the nonce itself. A token whose nonce
   * doesn't match was issued for another sign-in (a replay), and is refused.
   */
  async verifyApple(identityToken: string, name: string | undefined, nonce: string): Promise<SocialProfile> {
    const audience = this.config.get('APPLE_CLIENT_IDS');
    if (!audience.length) throw new ServiceUnavailableException('Apple sign-in is not configured.');
    try {
      const { payload } = await jwtVerify(identityToken, this.appleKeys, { issuer: APPLE_ISSUER, audience });
      if (!payload.sub) throw new Error('no subject');
      if (payload.nonce !== createHash('sha256').update(nonce).digest('hex')) throw new Error('nonce mismatch');
      const email = typeof payload.email === 'string' ? payload.email.toLowerCase() : undefined;
      const verified = payload.email_verified === true || payload.email_verified === 'true';
      return { providerUserId: payload.sub, email, emailVerified: verified, name };
    } catch {
      throw new UnauthorizedException('Apple sign-in failed. Please try again.');
    }
  }
}
