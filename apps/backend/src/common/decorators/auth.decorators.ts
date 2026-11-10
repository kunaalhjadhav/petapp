import { SetMetadata, createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { FeatureFlagKey, PermissionKey } from '@petapp/types';
import type { Principal } from '../principal';

export const IS_PUBLIC = 'auth:public';
export const OPTIONAL_AUTH = 'auth:optional';
export const ADMIN_ONLY = 'auth:admin';
export const PERMISSIONS_KEY = 'auth:permissions';
export const FEATURE_KEY = 'feature:flag';

/** No authentication required. */
export const Public = () => SetMetadata(IS_PUBLIC, true);
/** Authentication optional: the principal is attached when a valid token is sent. */
export const OptionalAuth = () => SetMetadata(OPTIONAL_AUTH, true);
/** Requires an Admin Dashboard token (audience ADMIN). */
export const AdminOnly = () => SetMetadata(ADMIN_ONLY, true);
/** Phase 10a: reachable by staff who must set up two-factor sign-in but haven't yet (setup, sign-out, their own details). */
export const MFA_SETUP_ALLOWED = 'auth:mfa-setup-allowed';
export const MfaSetupAllowed = () => SetMetadata(MFA_SETUP_ALLOWED, true);
/** Requires ALL listed permissions. */
export const RequirePermissions = (...perms: PermissionKey[]) => SetMetadata(PERMISSIONS_KEY, perms);
/** Route answers 404 unless the feature flag is on. */
export const RequireFeature = (flag: FeatureFlagKey) => SetMetadata(FEATURE_KEY, flag);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): Principal | undefined => {
  return ctx.switchToHttp().getRequest().principal;
});

export interface RequestMetaInfo {
  ip?: string;
  userAgent?: string;
}

export const RequestMeta = createParamDecorator((_: unknown, ctx: ExecutionContext): RequestMetaInfo => {
  const req = ctx.switchToHttp().getRequest();
  return { ip: req.ip, userAgent: req.headers['user-agent'] };
});
