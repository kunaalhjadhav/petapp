import type { TokenAudience, UserStatus } from '../generated/prisma/client';

export interface Principal {
  userId: string;
  sessionId: string;
  audience: TokenAudience;
  status: UserStatus;
  roles: string[];
  permissions: string[];
  isSuperAdmin: boolean;
}

export interface AccessTokenPayload {
  sub: string;
  sid: string;
  aud: string;
  iss: string;
}
