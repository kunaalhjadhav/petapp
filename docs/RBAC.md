# Roles and permissions

Roles and their permissions are stored in the database and edited from the Admin Dashboard (`/admin/roles`). The table below shows the **defaults** applied when a role is first created. After that the dashboard is the source of truth. Seeding again never overwrites your changes, except that SUPER_ADMIN always keeps every permission.

"PET" in the original spec is a *profile owned by a customer*, not a login role, so it is modelled as the `Pet` table.

| Permission | CUSTOMER | SERVICE_PARTNER | PRODUCT_PARTNER | JUDGE | MODERATOR | SUPPORT_AGENT | ADMIN | SUPER_ADMIN |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| users.read | | | | | ✔ | ✔ | ✔ | ✔ |
| users.update | | | | | | ✔ | ✔ | ✔ |
| users.suspend | | | | | | | ✔ | ✔ |
| users.roles.assign | | | | | | | ✔ | ✔ |
| roles.read | | | | | | | ✔ | ✔ |
| roles.manage | | | | | | | | ✔ |
| pets.read_any | | | | | ✔ | ✔ | ✔ | ✔ |
| pets.moderate | | | | | ✔ | | ✔ | ✔ |
| pets.verify | | | | | ✔ | | ✔ | ✔ |
| species.manage | | | | | | | ✔ | ✔ |
| audit.read | | | | | | | ✔ | ✔ |
| settings.read | | | | | | | ✔ | ✔ |
| settings.manage | | | | | | | ✔ | ✔ |
| flags.manage | | | | | | | ✔ | ✔ |
| **Dashboard login (`isStaff`)** | | | | | ✔ | ✔ | ✔ | ✔ |

Customers and partners act on **their own** data through ownership checks (for example, a pet can only be edited by its owner, and another user's ID returns 404). They don't need permissions for that. Partner and judge permissions (bookings, catalogue, scoring) arrive with Phases 3–5.

## Rules that code enforces regardless of configuration

1. Admin-audience tokens are required for `/admin/*`, and app tokens are refused there. Admin tokens are refused on app routes.
2. Only a SUPER_ADMIN can grant or remove SUPER_ADMIN, or change a super admin's status.
3. A non-super admin can only grant or remove roles whose permissions they already hold, and cannot change their own roles.
4. The last SUPER_ADMIN cannot remove their own SUPER_ADMIN role.
5. The SUPER_ADMIN role cannot be edited. System roles cannot be deleted, and a role still assigned to users cannot be deleted.
6. Nobody can change their own account status.
7. Every change to roles, users, pets, species, flags and settings writes an audit row in the same transaction.

## Marketplace (Phase 5)

| Permission | What it allows | Default roles |
|---|---|---|
| `marketplace.read` | View vendors, products, orders, returns and coupons | Super admin, Admin, Moderator |
| `marketplace.manage` | Review vendors, set commission, block products, manage categories and coupons | Super admin, Admin |

Approved vendors receive the **Product partner** role automatically.

## Finance (Phase 6a)

| Permission | What it allows | Default roles |
|---|---|---|
| `finance.read` | View the ledger, balances, refunds, reconciliation and tax reports | Super admin, Admin, Finance |
| `finance.manage` | Retry failed refunds or record ones paid another way, run reconciliation, resolve issues, recover missed payments | Super admin, Admin, Finance |
| `legal.manage` | Edit and publish legal documents (privacy policy, terms, policies) | Super admin, Admin |
| `privacy.manage` | Erase accounts whose owner asked for deletion, or cancel a deletion at the person’s request | Super admin, Admin |

A new staff role, **Finance**, can sign in to the dashboard. By default it holds both finance permissions plus `marketplace.read`, `partners.read`, `contests.read` and `audit.read`, so it can trace any money back to the order, booking or contest behind it.

Sellers and partners see only their own account, through `GET /vendor/statement` and `GET /partner/statement`.

## Support (Phase 9a)

| Permission | Lets staff |
|---|---|
| `support.read` | Read support tickets (including staff notes), FAQs and topics |
| `support.manage` | Reply, add notes, assign, change status and priority, start a conversation with someone, edit FAQs and topics |

Support agents get both by default; admins and super admins have them too. **Staff passwords** (Phase 9e): everyone changes their own; sending another staff member a reset link uses `users.roles.assign` (admins). **Two-factor sign-in** (Phase 10a): everyone sets up their own; resetting another staff member's (a lost phone) also uses `users.roles.assign`, and nobody can reset their own. **Analytics** (Phase 9d) uses `analytics.read` (Finance has it; it shows totals only, never one person's activity). **Memberships** use `memberships.read` (Support agents and Finance have it) and `memberships.manage` (admins: edit plans, give or end a membership). **Promotions** use `promotions.manage` (admins). **Locations** (Phase 9c) uses `locations.read` (Support agents have it) and `locations.manage` (admins). **Reports** and **Reviews** (Phase 9b) use the existing `content.read` (to see them) and `content.moderate` (to hide or restore a review, and to decide cases). Private chats between customers and businesses are not readable by any role: a moderator sees a chat message (and the few around it) only when it is reported or flagged by AI moderation, through **Moderation** (`content.read`).
