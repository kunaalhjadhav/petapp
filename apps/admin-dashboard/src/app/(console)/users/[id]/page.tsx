import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PERMISSIONS, STAFF_ROLE_KEYS } from '@petapp/types';
import { ApiError, api } from '@/lib/api';
import { can, getMe } from '@/lib/me';
import { formatDate, formatDateTime, formatPhone, humanize, initials, timeAgo } from '@/lib/format';
import type { Role, SupportCategory, UserDetail } from '@/lib/types';
import {
  Facts,
  Monogram,
  NoAccess,
  PageHeader,
  Panel,
  Select,
  StatusTag,
  Tag,
  inputClass,
} from '@/components/ui';
import { ActionDialog } from '@/components/forms';
import { Trail } from '@/components/trail';
import { resetMfa, sendPasswordReset, setUserRoles, setUserStatus } from '../actions';
import { startTicket } from '../../support/actions';

export const metadata: Metadata = { title: 'Person' };

function uaSummary(ua: string | null): string {
  if (!ua) return 'Unknown device';
  const os = /Android/.test(ua)
    ? 'Android'
    : /iPhone|iPad|iOS/.test(ua)
      ? 'iOS'
      : /Windows/.test(ua)
        ? 'Windows'
        : /Mac OS/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : null;
  const app = /Dart|okhttp|CFNetwork/.test(ua)
    ? 'PetApp app'
    : /Chrome/.test(ua)
      ? 'Chrome'
      : /Safari/.test(ua)
        ? 'Safari'
        : /Firefox/.test(ua)
          ? 'Firefox'
          : 'Client';
  return os ? `${app} on ${os}` : app;
}

export default async function UserPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await getMe();
  if (!can(me, PERMISSIONS.USERS_READ)) return <NoAccess what="people" />;

  let u: UserDetail;
  try {
    u = await api<UserDetail>(`/admin/users/${id}`);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 400)) notFound();
    throw e;
  }
  const roles =
    can(me, PERMISSIONS.USERS_ROLES_ASSIGN) && can(me, PERMISSIONS.ROLES_READ)
      ? await api<Role[]>('/admin/roles')
      : null;
  const isSelf = u.id === me.id;
  const topics = can(me, PERMISSIONS.SUPPORT_MANAGE) && !isSelf && u.status !== 'DELETED'
    ? (await api<SupportCategory[]>('/admin/support/categories')).filter((c) => c.active)
    : null;
  const canStatus = can(me, PERMISSIONS.USERS_SUSPEND) && !isSelf;
  const providers = [...new Set(u.identities.map((i) => i.provider))];

  return (
    <>
      <PageHeader
        back={{ href: '/users', label: 'People' }}
        title={
          <span className="flex items-center gap-3">
            <Monogram text={initials(u.name)} size={40} tone="teal" />
            <span>{u.name ?? 'No name yet'}</span>
            <StatusTag status={u.status} />
          </span>
        }
        description={
          isSelf
            ? 'This is your own account. Status and roles have to be changed by another admin.'
            : undefined
        }
        actions={
          <>
            {topics && (
              <ActionDialog
                label="Message"
                title={`Message ${u.name ?? 'this person'}`}
                description="Starts a support ticket they can answer in the app. They get a notification."
                action={startTicket.bind(null, u.id)}
                submitLabel="Send"
                variant="primary"
              >
                <label className="flex flex-col gap-1.5 text-sm font-medium">
                  Subject
                  <input name="subject" required minLength={3} maxLength={120} className={inputClass} placeholder="e.g. About your refund" />
                </label>
                <label className="flex flex-col gap-1.5 text-sm font-medium">
                  Topic
                  <Select name="categoryId" required defaultValue="">
                    <option value="" disabled>
                      Choose a topic
                    </option>
                    {topics.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                </label>
                <label className="flex flex-col gap-1.5 text-sm font-medium">
                  Message
                  <textarea name="body" required maxLength={2000} rows={5} className={`${inputClass} h-auto py-2`} />
                </label>
              </ActionDialog>
            )}
            {roles && !isSelf && (
              <ActionDialog
                label="Edit roles"
                title="Edit roles"
                description="Roles decide what this person can do. The change applies within seconds."
                action={setUserRoles.bind(null, u.id)}
                submitLabel="Save roles"
              >
                <fieldset className="flex flex-col gap-2">
                  <legend className="sr-only">Roles</legend>
                  {roles.map((r) => (
                    <label
                      key={r.key}
                      className="flex items-start gap-3 rounded-md border border-line-soft px-3 py-2 hover:border-line"
                    >
                      <input
                        type="checkbox"
                        name="roles"
                        value={r.key}
                        defaultChecked={u.roles.includes(r.key)}
                        className="mt-1 accent-[var(--color-teal)]"
                      />
                      <span>
                        <span className="block text-sm font-medium">{r.name}</span>
                        {r.description && (
                          <span className="block text-xs text-muted">{r.description}</span>
                        )}
                      </span>
                    </label>
                  ))}
                </fieldset>
              </ActionDialog>
            )}
            {can(me, PERMISSIONS.USERS_ROLES_ASSIGN) && !isSelf && me.emailEnabled && u.email && u.status === 'ACTIVE' && u.roles.some((r) => (STAFF_ROLE_KEYS as string[]).includes(r)) && (
              <ActionDialog
                label="Send password reset"
                title="Send a password reset link?"
                description={`An email goes to ${u.email} with a link to set a new password. It works once, for a short time. You never see the link.`}
                action={sendPasswordReset.bind(null, u.id)}
                submitLabel="Send link"
              />
            )}
            {can(me, PERMISSIONS.USERS_ROLES_ASSIGN) && !isSelf && u.mfaEnabledAt && (
              <ActionDialog
                label="Reset two-factor"
                danger
                title="Reset two-factor sign-in?"
                description="For a lost phone. Their two-factor sign-in and recovery codes are removed, they’re signed out everywhere, and they set it up again next time. Check it’s really them asking first."
                action={resetMfa.bind(null, u.id)}
                submitLabel="Reset"
              />
            )}
            {canStatus && (
              <ActionDialog
                key={`status-${u.status}`}
                label={u.status === 'ACTIVE' ? 'Suspend or block' : 'Change status'}
                variant={u.status === 'ACTIVE' ? 'danger' : 'primary'}
                danger={u.status === 'ACTIVE'}
                title="Change account status"
                description="Suspending or blocking signs this person out on every device straight away."
                action={setUserStatus.bind(null, u.id)}
                submitLabel="Change status"
              >
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="st" className="text-sm font-medium">
                    New status
                  </label>
                  <Select
                    id="st"
                    name="status"
                    defaultValue={u.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE'}
                  >
                    <option value="ACTIVE">Active: can use the app</option>
                    <option value="SUSPENDED">Suspended: temporary, can be restored</option>
                    <option value="BLOCKED">Blocked: for serious or repeated abuse</option>
                  </Select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="reason" className="text-sm font-medium">
                    Reason
                  </label>
                  <textarea
                    id="reason"
                    name="reason"
                    required
                    minLength={3}
                    maxLength={500}
                    rows={3}
                    className={`${inputClass} h-auto py-2`}
                    placeholder="What happened, and any ticket or report number"
                  />
                </div>
              </ActionDialog>
            )}
          </>
        }
      />

      <div className="grid gap-8 lg:grid-cols-[1fr_18rem]">
        <div className="flex min-w-0 flex-col gap-6">
          {u.status !== 'ACTIVE' && u.statusReason && (
            <p className="rounded-md border border-warn/30 bg-warn-wash px-4 py-3 text-sm text-warn">
              <span className="font-medium">Reason on record:</span> {u.statusReason}
            </p>
          )}
          <Panel title="Account">
            <Facts
              items={[
                [
                  'Phone',
                  u.phone ? `${formatPhone(u.phone)}${u.phoneVerifiedAt ? ', verified' : ''}` : '—',
                ],
                [
                  'Email',
                  u.email
                    ? `${u.email}${u.emailVerifiedAt ? ', verified' : ', not verified'}`
                    : '—',
                ],
                ['Signs in with', providers.map((p) => humanize(p)).join(', ') || '—'],
                ['Roles', u.roles.map(humanize).join(', ')],
                ['Joined', formatDate(u.createdAt)],
                [
                  'Last sign-in',
                  u.lastLoginAt
                    ? `${timeAgo(u.lastLoginAt)} (${formatDateTime(u.lastLoginAt)})`
                    : 'Never',
                ],
                ['City', u.city ?? '—'],
                ['Marketing messages', u.marketingConsent ? 'Opted in' : 'Not opted in'],
                ['Followers', `${u._count.followers} followers, following ${u._count.following}`],
                ['Saved addresses', String(u.addresses.length)],
              ]}
            />
          </Panel>

          <Panel title={`Pets (${u.pets.length})`}>
            {u.pets.length === 0 ? (
              <p className="px-4 py-4 text-sm text-muted">No pet profiles.</p>
            ) : (
              <ul className="divide-y divide-line-soft">
                {u.pets.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <Link href={`/pets/${p.id}`} className="min-w-0">
                      <span className="font-medium">{p.name}</span>{' '}
                      <span className="text-sm text-muted">@{p.handle}</span>
                    </Link>
                    <span className="flex gap-1.5">
                      {p.isVerified && <Tag tone="teal">Verified</Tag>}
                      {p.deletedAt ? <Tag>Deleted by owner</Tag> : <StatusTag status={p.status} />}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Signed-in devices">
            {u.sessions.length === 0 ? (
              <p className="px-4 py-4 text-sm text-muted">Not signed in anywhere.</p>
            ) : (
              <ul className="divide-y divide-line-soft">
                {u.sessions.map((s) => (
                  <li
                    key={s.id}
                    className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm"
                  >
                    <span>
                      {uaSummary(s.userAgent)}
                      {s.audience === 'ADMIN' && (
                        <>
                          {' '}
                          <Tag tone="warn">Admin</Tag>
                        </>
                      )}
                    </span>
                    <span className="text-muted">
                      since {formatDateTime(s.createdAt)}
                      {s.ipAddress ? `, ${s.ipAddress}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
        <Trail entityType="User" entityId={u.id} />
      </div>
    </>
  );
}
