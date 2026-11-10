# Phase 1 — Foundation: report

## 1. Implemented

- **Monorepo:** npm workspaces with `apps/backend` (NestJS 10) and `packages/types` (shared contracts).
- **Database:** PostgreSQL through Prisma 7, using the `pg` driver adapter so there is no native engine at runtime. The schema has 19 tables and there are 2 migrations.
- **Auth:**
  - Phone OTP: codes are HMAC-hashed, expire after 5 minutes and allow 5 attempts. They are consumed atomically. There is a resend cooldown, an hourly cap per number and a per-IP rate limit.
  - Email and password, hashed with bcrypt. Unknown emails take the same time to reject as wrong passwords.
  - Google and Apple sign-in, verified on the server.
  - Accounts are linked only when the provider has verified the email.
- **Sessions:**
  - 15-minute JWT access tokens.
  - Opaque refresh tokens that rotate on every refresh, with reuse detection that revokes the whole session family.
  - Logout and logout from all devices.
  - Separate app and admin token audiences.
- **Roles and permissions:**
  - 8 roles and 14 permissions, stored in the database and editable in the admin API.
  - Changes take effect within seconds through a Redis cache that is invalidated on change.
  - Privilege-escalation guards.
- **Users:** profile, preferences, marketing consent, account deletion request (signs out everywhere), addresses (Indian PIN codes, one default), follow and unfollow, and public profiles.
- **Pets:**
  - Multiple pets per user, up to a configurable limit.
  - The breed must belong to the chosen species.
  - Each pet gets a public handle for deep links, such as `bruno.3fa9c1`.
  - Public, followers-only and private visibility.
  - Owner-only fields (microchip, medical notes, vaccinations, exact coordinates).
  - Vaccination records, idempotent follows with an accurate count, and public discovery with filters and pagination.
- **Admin:**
  - Staff login.
  - User search, detail, suspend, block and restore (sessions revoked immediately), and role assignment.
  - Pet list and detail, verify, hide and remove.
  - Species and breed management.
  - Feature flags (all 8 from the spec), typed settings, and an audit log viewer with filters.
- **Audit:** every administrative and security-relevant change is recorded in the same transaction. The table is append-only, enforced by a database trigger.
- **Platform:**
  - The response envelope and friendly error messages; Prisma errors are mapped to 404 and 409.
  - A request ID on every call, helmet security headers and a CORS allowlist.
  - Strict validation that rejects unknown fields, and a 1 MB body limit.
  - Rate limiting shared across replicas through Redis (an atomic Lua script).
  - Swagger docs, and `/health` and `/ready` endpoints.
  - A `@RequireFeature()` guard for flag-gated routes in later phases.
- **SMS:** a provider abstraction with console (development only) and SMSLocal (including the DLT template and entity fields) implementations.
- **Seed:** roles and permissions, 8 species with 60+ breeds, flags, settings, the first SUPER_ADMIN from environment variables, and fictional demo data. The seed is idempotent.
- **Delivery:** a multi-stage Dockerfile (runtime and migrate targets, non-root user, healthcheck), docker-compose, CI (lint, types, migration drift, unit, e2e on real Postgres + Redis, build, Trivy image scan) and a deploy workflow (staging, then an approval gate, then production).

## 2. Files

- `apps/backend/src/**`: 57 source files across the config, prisma, redis, common, providers, auth, rbac, users, pets, platform, audit and health modules.
- `apps/backend/test/**`: e2e suite, harness and global setup.
- `packages/types/src/index.ts`
- `prisma/schema.prisma`, `prisma/migrations/*`, `prisma/seed/{seed,species,demo}.ts`, `prisma.config.ts`
- `infrastructure/Dockerfile.backend`, `infrastructure/postgres-init.sql`, `docker-compose.yml`
- `.github/workflows/{ci,deploy}.yml`, `.env.example`, `README.md`
- `docs/*`

## 3. Migrations

| Migration | Content |
|---|---|
| `20260930120000_init` | 9 enums, 19 tables, 33 indexes, 19 foreign keys |
| `20260930120100_audit_log_append_only` | Trigger that blocks UPDATE and DELETE on `AuditLog`. It allows only the `actorId → NULL` change needed when a user is purged. |

**Note:** Prisma's migration engine could not be downloaded in the build sandbox, so `init` was generated from Prisma's own parsed schema model following Prisma's naming conventions. It was then applied to a real PostgreSQL 16, and the whole test suite ran on it. `npm run db:check-drift` (also a CI step) confirms it matches `schema.prisma` exactly. Run it once after `npm install`; it should exit 0.

## 4. Environment variables

See `.env.example`. **Required:** `DATABASE_URL`, `REDIS_URL`, `JWT_ACCESS_SECRET` (≥32 characters), `JWT_REFRESH_SECRET` (≥32 characters, different from the access secret) and `OTP_PEPPER` (≥16 characters). Everything else has safe defaults. The SMSLocal variables become required when `SMS_PROVIDER=smslocal`, and that provider is mandatory on staging and production.

## 5. Endpoints

There are 61 endpoints: 57 under `/api/v1` plus `/health`, `/ready`, `/api/docs` and `/api/docs-json`. They are grouped as follows:

- Auth: 9
- Admin auth: 3
- Users: 10
- Admin users: 4
- Pets: 10
- Species: 2
- Admin pets and species: 10
- Roles: 5
- Platform: 5
- Audit: 1
- Config: 1

The full list is in `docs/API.md`, with the OpenAPI spec in `docs/openapi.json`.

## 6. Tests

- **Unit (44):**
  - Phone normalisation. This caught and fixed a bug where an 11-digit number typed without `+` was accepted as a foreign number.
  - Crypto helpers and slugs.
  - Environment validation.
  - The permissions guard and the response envelope.
  - The OTP service (hashing, single use, attempt lockout, cooldown, expiry).
  - Pet age calculation.
- **End-to-end (27):** real PostgreSQL 16 + Redis 7, through the full HTTP pipeline:
  - The error envelope and rejection of unknown fields.
  - OTP signup, wrong code and single use.
  - Per-IP rate limiting.
  - Email register, duplicate and password strength.
  - Refresh rotation and reuse detection.
  - Logout revocation.
  - The breed must belong to the species.
  - Private fields are hidden from other users.
  - IDOR on pets and addresses.
  - Follow idempotency and counts.
  - Visibility and discovery.
  - App and admin token separation.
  - Suspension takes effect immediately, revokes sessions and is audited.
  - Moderator permission limits.
  - Privilege escalation is blocked.
  - Live role edits take effect.
  - Species and breed admin.
  - Flags and typed settings enforced at runtime.
  - The audit log cannot be tampered with at the database level.

Lint, type check and build are clean. The pruned production build was booted and passed readiness, with Swagger correctly disabled in production.

## 7. Setup

See `README.md`. On Windows (PowerShell):

1. `docker compose up -d postgres redis`
2. Copy `.env.example` to `.env` and fill in the secrets.
3. `npm install`
4. `npm run db:check-drift`
5. `npm run db:deploy`
6. `npm run db:seed`
7. `npm run dev`

## 8. Deployment

See `docs/DEPLOYMENT.md`:

- Image build and the migrate job.
- Rolling deploy with `/health` and `/ready`.
- The secrets policy.
- Backups (point-in-time recovery, RPO ≤ 5 min, RTO ≤ 1 h) and a quarterly restore drill.

The deploy workflow's registry and hosting steps are deliberately left failing until a hosting target is chosen.

## 9. Security checklist (Phase 1 scope)

| Item | How it's covered |
|---|---|
| Hashing | Passwords (bcrypt), OTPs and refresh tokens (HMAC with separate secrets) are hashed |
| Credential leakage | No secrets, hashes or stack traces in responses |
| IDOR | Every owner-scoped query filters by owner and returns 404 for others |
| Admin surface | Separated by token audience plus permissions |
| Rate limits | On all auth routes, shared across replicas |
| Input validation | Whitelist validation; `https` required for image URLs |
| Headers and CORS | Security headers; CORS allowlist |
| Audit | Append-only audit trail |

## 10. Known limitations and next steps

- **Email verification and password reset:** these need an `EmailProvider` and arrive with Phase 2 (`emailVerifiedAt` is already stored).
- **Media upload:** avatar and cover images are HTTPS URLs for now. Signed uploads through `StorageProvider` arrive in Phase 2.
- **Account deletion:** this marks the account and signs it out. The scheduled purge and data-export jobs arrive in Phase 8.
- **Husky / commit hooks:** add them once the repo is under git (`npx husky init`). CI already enforces lint and types.
- **Structured JSON logs, metrics, tracing and Sentry:** Phase 8. Request IDs are already propagated.
- **Admin dashboard UI:** not started. This phase is the API it needs. The proposed next step is a Next.js admin shell (Phase 1b), then Phase 2.
- **Not executed in the sandbox:** the Docker images and GitHub workflows (no Docker daemon there). Both use only standard steps; run `docker compose up --build` once to confirm.
