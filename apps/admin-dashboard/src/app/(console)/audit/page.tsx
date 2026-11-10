import Link from 'next/link';
import type { Metadata } from 'next';
import { PERMISSIONS } from '@petapp/types';
import { apiPage } from '@/lib/api';
import { can, getMe } from '@/lib/me';
import { describeAction, formatDateTime } from '@/lib/format';
import type { AuditEntry } from '@/lib/types';
import { FLAG_LABELS, SETTING_LABELS } from '@/lib/labels';
import {
  Empty,
  NoAccess,
  PageHeader,
  Panel,
  Select,
  buttonClass,
  inputClass,
} from '@/components/ui';
import { Pagination, Table, Td } from '@/components/table';

export const metadata: Metadata = { title: 'Audit log' };

const ACTIONS = [
  'user.status',
  'user.roles',
  'user.register',
  'user.delete_request',
  'admin.login',
  'admin.login_denied',
  'pet.create',
  'pet.delete',
  'pet.verify',
  'pet.status',
  'species.create',
  'species.update',
  'breed.create',
  'breed.update',
  'role.create',
  'role.update',
  'role.delete',
  'flag.update',
  'setting.update',
];
const TYPES: Record<string, string> = {
  User: 'Person',
  Pet: 'Pet',
  Role: 'Role',
  PetSpecies: 'Species',
  PetBreed: 'Breed',
  FeatureFlag: 'Feature',
  AppSetting: 'Setting',
};

function recordLink(e: AuditEntry) {
  if (!e.entityId) return <span className="text-muted">{TYPES[e.entityType] ?? e.entityType}</span>;
  const label = TYPES[e.entityType] ?? e.entityType;
  if (e.entityType === 'User')
    return (
      <Link className="text-teal hover:underline" href={`/users/${e.entityId}`}>
        {label}
      </Link>
    );
  if (e.entityType === 'Pet')
    return (
      <Link className="text-teal hover:underline" href={`/pets/${e.entityId}`}>
        {label}
      </Link>
    );
  if (e.entityType === 'Role')
    return (
      <Link className="text-teal hover:underline" href="/access">{`${label}: ${e.entityId}`}</Link>
    );
  if (e.entityType === 'FeatureFlag' || e.entityType === 'AppSetting') {
    const name = FLAG_LABELS[e.entityId]?.name ?? SETTING_LABELS[e.entityId]?.name ?? e.entityId;
    return (
      <Link className="text-teal hover:underline" href="/settings">
        {`${label}: ${name}`}
      </Link>
    );
  }
  return <span>{label}</span>;
}

const json = (v: unknown) => (v === null || v === undefined ? '—' : JSON.stringify(v, null, 2));

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  if (!can(me, PERMISSIONS.AUDIT_READ)) return <NoAccess what="the audit log" />;
  const toIso = (d?: string, end = false) =>
    d ? new Date(`${d}T${end ? '23:59:59.999' : '00:00:00'}+05:30`).toISOString() : undefined;
  const { items, meta } = await apiPage<AuditEntry>('/admin/audit-logs', {
    action: sp.action,
    entityType: sp.entityType,
    entityId: sp.entityId,
    actorId: sp.actorId,
    from: toIso(sp.from),
    to: toIso(sp.to, true),
    page: sp.page,
    limit: 30,
  });
  const filtered = Object.entries(sp).some(([k, v]) => k !== 'page' && v);

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Every change made by staff and every security-relevant event, newest first. Entries can’t be edited or deleted."
      />
      <Panel>
        <form className="flex flex-wrap items-end gap-3 border-b border-line-soft px-4 py-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="action" className="text-xs text-muted">
              Action
            </label>
            <Select id="action" name="action" defaultValue={sp.action ?? ''}>
              <option value="">Any action</option>
              {ACTIONS.map((a) => (
                <option key={a} value={a}>
                  {describeAction(a)}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="entityType" className="text-xs text-muted">
              Record type
            </label>
            <Select id="entityType" name="entityType" defaultValue={sp.entityType ?? ''}>
              <option value="">Any record</option>
              {Object.entries(TYPES).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="from" className="text-xs text-muted">
              From
            </label>
            <input
              id="from"
              name="from"
              type="date"
              defaultValue={sp.from}
              className={inputClass}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="to" className="text-xs text-muted">
              To
            </label>
            <input id="to" name="to" type="date" defaultValue={sp.to} className={inputClass} />
          </div>
          {sp.entityId && <input type="hidden" name="entityId" value={sp.entityId} />}
          {sp.actorId && <input type="hidden" name="actorId" value={sp.actorId} />}
          <button className={buttonClass('secondary')}>Apply</button>
          {filtered && (
            <Link href="/audit" className={buttonClass('quiet')}>
              Clear
            </Link>
          )}
        </form>
        {(sp.entityId || sp.actorId) && (
          <p className="border-b border-line-soft px-4 py-2 text-sm text-muted">
            Showing entries {sp.entityId ? 'for one record' : 'by one person'}.
          </p>
        )}

        {items.length === 0 ? (
          <Empty title={filtered ? 'No entries match these filters' : 'No entries yet'} />
        ) : (
          <Table head={['When', 'Who', 'What', 'Record', 'Details']}>
            {items.map((e) => (
              <tr key={e.id} className="align-top">
                <Td className="whitespace-nowrap text-muted">{formatDateTime(e.createdAt)}</Td>
                <Td>
                  {e.actor ? (
                    <Link href={`/audit?actorId=${e.actor.id}`} className="hover:underline">
                      {e.actor.name ?? e.actor.email}
                    </Link>
                  ) : (
                    <span className="text-muted">System</span>
                  )}
                </Td>
                <Td>{describeAction(e.action)}</Td>
                <Td>{recordLink(e)}</Td>
                <Td>
                  {e.before !== null || e.after !== null ? (
                    <details>
                      <summary className="cursor-pointer text-teal">Show change</summary>
                      <div className="mt-2 grid gap-2 sm:grid-cols-2">
                        <div>
                          <p className="text-xs text-muted">Before</p>
                          <pre className="mt-1 max-w-xs overflow-x-auto rounded bg-paper p-2 text-xs">
                            {json(e.before)}
                          </pre>
                        </div>
                        <div>
                          <p className="text-xs text-muted">After</p>
                          <pre className="mt-1 max-w-xs overflow-x-auto rounded bg-paper p-2 text-xs">
                            {json(e.after)}
                          </pre>
                        </div>
                      </div>
                      {e.ipAddress && <p className="mt-1 text-xs text-faint">From {e.ipAddress}</p>}
                    </details>
                  ) : (
                    <span className="text-faint">—</span>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
        <Pagination meta={meta} basePath="/audit" params={sp} />
      </Panel>
    </>
  );
}
