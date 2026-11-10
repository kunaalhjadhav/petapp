// Shared contracts used by the backend, admin dashboard and API client.

export const ROLE_KEYS = [
  'CUSTOMER',
  'SERVICE_PARTNER',
  'PRODUCT_PARTNER',
  'JUDGE',
  'MODERATOR',
  'SUPPORT_AGENT',
  'FINANCE',
  'ADMIN',
  'SUPER_ADMIN',
] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

/** Roles allowed to sign in to the Admin Dashboard by default (editable per role in the DB). */
export const STAFF_ROLE_KEYS: RoleKey[] = ['MODERATOR', 'SUPPORT_AGENT', 'FINANCE', 'ADMIN', 'SUPER_ADMIN'];

/**
 * Permission catalogue. Only permissions for modules that exist are listed;
 * each phase adds its own keys here and in the seed.
 */
export const PERMISSIONS = {
  // users
  USERS_READ: 'users.read',
  USERS_UPDATE: 'users.update',
  USERS_SUSPEND: 'users.suspend',
  USERS_ROLES_ASSIGN: 'users.roles.assign',
  // rbac
  ROLES_READ: 'roles.read',
  ROLES_MANAGE: 'roles.manage',
  // pets
  PETS_READ_ANY: 'pets.read_any',
  PETS_MODERATE: 'pets.moderate',
  PETS_VERIFY: 'pets.verify',
  SPECIES_MANAGE: 'species.manage',
  // platform
  AUDIT_READ: 'audit.read',
  SETTINGS_READ: 'settings.read',
  SETTINGS_MANAGE: 'settings.manage',
  FLAGS_MANAGE: 'flags.manage',
  // content (Phase 2)
  CONTENT_READ: 'content.read',
  CONTENT_MODERATE: 'content.moderate',
  HOME_MANAGE: 'home.manage',
  // contests (Phase 3)
  CONTESTS_READ: 'contests.read',
  CONTESTS_MANAGE: 'contests.manage',
  CONTESTS_LEGAL_APPROVE: 'contests.legal_approve',
  // challenges (Phase 3c)
  CHALLENGES_MANAGE: 'challenges.manage',
  // marketplace (Phase 5)
  MARKETPLACE_READ: 'marketplace.read',
  MARKETPLACE_MANAGE: 'marketplace.manage',
  // services marketplace (Phase 4)
  PARTNERS_READ: 'partners.read',
  PARTNERS_REVIEW: 'partners.review',
  SERVICES_MANAGE: 'services.manage',
  // finance (Phase 6)
  FINANCE_READ: 'finance.read',
  FINANCE_MANAGE: 'finance.manage',
  // privacy and legal (Phase 8b)
  LEGAL_MANAGE: 'legal.manage',
  PRIVACY_MANAGE: 'privacy.manage',
  // support center (Phase 9a)
  SUPPORT_READ: 'support.read',
  SUPPORT_MANAGE: 'support.manage',
  LOCATIONS_READ: 'locations.read',
  LOCATIONS_MANAGE: 'locations.manage',
  // analytics, memberships and promotions (Phase 9d)
  ANALYTICS_READ: 'analytics.read',
  MEMBERSHIPS_READ: 'memberships.read',
  MEMBERSHIPS_MANAGE: 'memberships.manage',
  PROMOTIONS_MANAGE: 'promotions.manage',
} as const;
export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const FEATURE_FLAGS = [
  'ENABLE_CONTESTS',
  'ENABLE_PUBLIC_VOTING',
  'ENABLE_PAID_VOTING',
  'ENABLE_MARKETPLACE',
  'ENABLE_SERVICES',
  'ENABLE_AI_ASSISTANT',
  'ENABLE_REELS',
  'ENABLE_CHAT',
  'ENABLE_MEMBERSHIPS',
] as const;
export type FeatureFlagKey = (typeof FEATURE_FLAGS)[number];

export interface ApiSuccess<T> {
  success: true;
  data: T;
  message: string;
  meta: Record<string, unknown>;
}

export interface ApiError {
  success: false;
  message: string;
  errors: Array<{ field?: string; code?: string; message: string }>;
  requestId?: string;
}

export interface PageMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresIn: number;
  refreshTokenExpiresAt: string;
}
