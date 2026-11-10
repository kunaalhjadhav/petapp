import { PERMISSIONS, type PermissionKey, type RoleKey } from '@petapp/types';

export const PERMISSION_CATALOG: Array<{ key: PermissionKey; module: string; description: string }> = [
  { key: PERMISSIONS.USERS_READ, module: 'users', description: 'Search and view user accounts' },
  { key: PERMISSIONS.USERS_UPDATE, module: 'users', description: 'Edit selected user account settings' },
  { key: PERMISSIONS.USERS_SUSPEND, module: 'users', description: 'Suspend, block and restore users' },
  { key: PERMISSIONS.USERS_ROLES_ASSIGN, module: 'users', description: 'Assign and remove user roles' },
  { key: PERMISSIONS.ROLES_READ, module: 'rbac', description: 'View roles and permissions' },
  { key: PERMISSIONS.ROLES_MANAGE, module: 'rbac', description: 'Create, edit and delete roles' },
  { key: PERMISSIONS.PETS_READ_ANY, module: 'pets', description: 'View any pet profile, including private fields' },
  { key: PERMISSIONS.PETS_MODERATE, module: 'pets', description: 'Hide, remove and restore pet profiles' },
  { key: PERMISSIONS.PETS_VERIFY, module: 'pets', description: 'Mark pets as verified' },
  { key: PERMISSIONS.SPECIES_MANAGE, module: 'pets', description: 'Manage species and breeds' },
  { key: PERMISSIONS.AUDIT_READ, module: 'platform', description: 'Read audit logs' },
  { key: PERMISSIONS.SETTINGS_READ, module: 'platform', description: 'Read platform settings' },
  { key: PERMISSIONS.SETTINGS_MANAGE, module: 'platform', description: 'Change platform settings' },
  { key: PERMISSIONS.FLAGS_MANAGE, module: 'platform', description: 'Toggle feature flags' },
  { key: PERMISSIONS.CONTENT_READ, module: 'content', description: 'View reports, moderation cases and any post or comment' },
  { key: PERMISSIONS.CONTENT_MODERATE, module: 'content', description: 'Resolve reports: hide or remove content, dismiss cases' },
  { key: PERMISSIONS.HOME_MANAGE, module: 'content', description: 'Arrange the customer app’s home screen: sections, schedules, targeting and pinned items' },
  { key: PERMISSIONS.CONTESTS_READ, module: 'contests', description: 'View contests, entries, finances and flagged votes' },
  { key: PERMISSIONS.CONTESTS_MANAGE, module: 'contests', description: 'Build and run contests: lifecycle, entries, votes, winners' },
  { key: PERMISSIONS.MARKETPLACE_READ, module: 'marketplace', description: 'View vendors, products, orders, returns and coupons' },
  { key: PERMISSIONS.MARKETPLACE_MANAGE, module: 'marketplace', description: 'Review vendors, block products, manage categories and coupons, override orders and returns' },
  { key: PERMISSIONS.CHALLENGES_MANAGE, module: 'contests', description: 'Create and run challenges and badges' },
  { key: PERMISSIONS.PARTNERS_READ, module: 'services', description: 'View service partners, their documents and bookings' },
  { key: PERMISSIONS.PARTNERS_REVIEW, module: 'services', description: 'Approve, reject or suspend service partners' },
  { key: PERMISSIONS.SERVICES_MANAGE, module: 'services', description: 'Manage service categories, commissions and bookings (cancel, refund)' },
  { key: PERMISSIONS.CONTESTS_LEGAL_APPROVE, module: 'contests', description: 'Record the legal review that lets a paid contest go live' },
  { key: PERMISSIONS.FINANCE_READ, module: 'finance', description: 'View the ledger, balances, refunds, reconciliation and tax reports' },
  { key: PERMISSIONS.LEGAL_MANAGE, module: 'privacy', description: 'Edit and publish legal documents (privacy policy, terms, policies)' },
  { key: PERMISSIONS.PRIVACY_MANAGE, module: 'privacy', description: 'Erase accounts that asked for deletion, or cancel a deletion at the person’s request' },
  { key: PERMISSIONS.SUPPORT_READ, module: 'support', description: 'Read support tickets (including staff notes), FAQs and topics' },
  { key: PERMISSIONS.SUPPORT_MANAGE, module: 'support', description: 'Reply to tickets, assign them, change their status, start conversations with people, and edit FAQs and topics' },
  { key: PERMISSIONS.LOCATIONS_READ, module: 'locations', description: 'See cities, areas, PIN codes, delivery zones, service coverage and partner locations' },
  { key: PERMISSIONS.LOCATIONS_MANAGE, module: 'locations', description: 'Add and edit cities, areas and PIN codes (including imports), delivery zones, service coverage and partner locations' },
  { key: PERMISSIONS.ANALYTICS_READ, module: 'analytics', description: 'See analytics: users, reels, contests, shop and services (totals only, never individual activity)' },
  { key: PERMISSIONS.MEMBERSHIPS_READ, module: 'memberships', description: 'See membership plans and members' },
  { key: PERMISSIONS.MEMBERSHIPS_MANAGE, module: 'memberships', description: 'Edit membership plans, and grant or end someone’s membership' },
  { key: PERMISSIONS.PROMOTIONS_MANAGE, module: 'notifications', description: 'Send promotional notifications to people who opted in' },
  { key: PERMISSIONS.FINANCE_MANAGE, module: 'finance', description: 'Retry refunds or record ones paid another way, run reconciliation, resolve issues and recover missed payments' },
];

const ALL = PERMISSION_CATALOG.map((p) => p.key);
const P = PERMISSIONS;

/**
 * System roles and their DEFAULT permissions. Defaults are applied only when a role is first
 * created; afterwards the Admin Dashboard owns the assignments.
 */
export const ROLE_CATALOG: Array<{ key: RoleKey; name: string; description: string; isStaff: boolean; permissions: PermissionKey[] }> = [
  { key: 'CUSTOMER', name: 'Customer', description: 'Pet owner using the customer app', isStaff: false, permissions: [] },
  { key: 'SERVICE_PARTNER', name: 'Service partner', description: 'Groomers, trainers, boarding, vets and other service businesses', isStaff: false, permissions: [] },
  { key: 'PRODUCT_PARTNER', name: 'Product partner', description: 'Vendors selling pet products', isStaff: false, permissions: [] },
  { key: 'JUDGE', name: 'Judge', description: 'Verified contest judge', isStaff: false, permissions: [] },
  { key: 'MODERATOR', name: 'Moderator', description: 'Content and community moderation', isStaff: true, permissions: [P.USERS_READ, P.PETS_READ_ANY, P.PETS_MODERATE, P.PETS_VERIFY, P.CONTENT_READ, P.CONTENT_MODERATE, P.CONTESTS_READ, P.MARKETPLACE_READ] },
  { key: 'SUPPORT_AGENT', name: 'Support agent', description: 'Customer support', isStaff: true, permissions: [P.USERS_READ, P.USERS_UPDATE, P.PETS_READ_ANY, P.CONTENT_READ, P.PARTNERS_READ, P.SUPPORT_READ, P.SUPPORT_MANAGE, P.LOCATIONS_READ, P.MEMBERSHIPS_READ] },
  { key: 'FINANCE', name: 'Finance', description: 'Finance team: ledger, refunds, reconciliation and tax reports', isStaff: true, permissions: [P.FINANCE_READ, P.FINANCE_MANAGE, P.MARKETPLACE_READ, P.PARTNERS_READ, P.CONTESTS_READ, P.AUDIT_READ, P.ANALYTICS_READ, P.MEMBERSHIPS_READ] },
  { key: 'ADMIN', name: 'Admin', description: 'Platform administrator', isStaff: true, permissions: ALL.filter((k) => k !== P.ROLES_MANAGE && k !== P.CONTESTS_LEGAL_APPROVE) },
  { key: 'SUPER_ADMIN', name: 'Super admin', description: 'Full system access', isStaff: true, permissions: ALL },
];
