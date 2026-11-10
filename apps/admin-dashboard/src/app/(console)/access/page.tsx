import type { Metadata } from 'next';
import { PERMISSIONS } from '@petapp/types';
import { api } from '@/lib/api';
import { can, getMe } from '@/lib/me';
import { formatNumber, humanize } from '@/lib/format';
import type { Permission, Role } from '@/lib/types';
import { MODULE_LABELS } from '@/lib/labels';
import { Field, Input, NoAccess, PageHeader, Panel, Tag } from '@/components/ui';
import { ActionDialog } from '@/components/forms';
import { createRole, deleteRole, updateRole } from './actions';

export const metadata: Metadata = { title: 'Roles & permissions' };

function PermissionPicker({
  permissions,
  checked,
}: {
  permissions: Permission[];
  checked: string[];
}) {
  const modules = [...new Set(permissions.map((p) => p.module))];
  return (
    <div className="flex max-h-[45vh] flex-col gap-4 overflow-y-auto pr-1">
      {modules.map((m) => (
        <fieldset key={m}>
          <legend className="mb-1.5 text-sm font-medium">{MODULE_LABELS[m] ?? humanize(m)}</legend>
          <div className="flex flex-col gap-1">
            {permissions
              .filter((p) => p.module === m)
              .map((p) => (
                <label key={p.key} className="flex items-start gap-2.5 text-sm">
                  <input
                    type="checkbox"
                    name="permissions"
                    value={p.key}
                    defaultChecked={checked.includes(p.key)}
                    className="mt-1 accent-[var(--color-teal)]"
                  />
                  <span>{p.description ?? p.key}</span>
                </label>
              ))}
          </div>
        </fieldset>
      ))}
    </div>
  );
}

export default async function AccessPage() {
  const me = await getMe();
  if (!can(me, PERMISSIONS.ROLES_READ)) return <NoAccess what="roles and permissions" />;
  const [roles, permissions] = await Promise.all([
    api<Role[]>('/admin/roles'),
    api<Permission[]>('/admin/permissions'),
  ]);
  const manage = can(me, PERMISSIONS.ROLES_MANAGE);
  const modules = [...new Set(permissions.map((p) => p.module))];

  return (
    <>
      <PageHeader
        title="Roles & permissions"
        description="What each role can do in this dashboard. Changes apply to everyone with the role within seconds."
        actions={
          manage && (
            <ActionDialog
              label="New role"
              variant="primary"
              title="Create a role"
              action={createRole}
              submitLabel="Create role"
            >
              <Field label="Name" htmlFor="rname">
                <Input
                  id="rname"
                  name="name"
                  required
                  maxLength={60}
                  placeholder="Content reviewer"
                />
              </Field>
              <Field label="Description" htmlFor="rdesc">
                <Input id="rdesc" name="description" maxLength={300} />
              </Field>
              <label className="flex items-center gap-2.5 text-sm">
                <input type="checkbox" name="isStaff" className="accent-[var(--color-teal)]" /> Can
                sign in to this dashboard
              </label>
              <PermissionPicker permissions={permissions} checked={[]} />
            </ActionDialog>
          )
        }
      />

      <Panel>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">Permissions held by each role</caption>
            <thead>
              <tr className="border-b border-line">
                <th
                  scope="col"
                  className="sticky left-0 w-60 min-w-52 bg-panel px-4 py-3 text-left align-top text-xs font-medium text-muted"
                >
                  Permission
                </th>
                {roles.map((r) => (
                  <th
                    key={r.key}
                    scope="col"
                    className="min-w-[5.75rem] px-2 py-3 text-left align-top"
                  >
                    <span className="block text-[13px] font-semibold leading-5">{r.name}</span>
                    <span className="block text-xs font-normal text-muted">
                      {formatNumber(r.userCount)} {r.userCount === 1 ? 'person' : 'people'}
                    </span>
                    {r.isStaff && (
                      <span className="mt-1 block">
                        <Tag tone="teal">Dashboard</Tag>
                      </span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {modules.map((m) => (
                <ModuleRows
                  key={m}
                  module={m}
                  permissions={permissions.filter((p) => p.module === m)}
                  roles={roles}
                />
              ))}
              {manage && (
                <tr className="border-t border-line">
                  <td className="sticky left-0 bg-panel px-4 py-3 text-xs text-muted">Edit</td>
                  {roles.map((r) => (
                    <td key={r.key} className="px-2 py-3">
                      {r.key === 'SUPER_ADMIN' ? (
                        <span className="text-xs text-muted">All, always</span>
                      ) : (
                        <span className="flex flex-col items-start gap-1">
                          <ActionDialog
                            label="Edit"
                            size="sm"
                            variant="quiet"
                            title={`Edit ${r.name}`}
                            description={`${formatNumber(r.userCount)} ${r.userCount === 1 ? 'person has' : 'people have'} this role.`}
                            action={updateRole.bind(null, r.key)}
                            submitLabel="Save role"
                          >
                            <Field label="Name" htmlFor={`n-${r.key}`}>
                              <Input
                                id={`n-${r.key}`}
                                name="name"
                                defaultValue={r.name}
                                maxLength={60}
                              />
                            </Field>
                            <Field label="Description" htmlFor={`d-${r.key}`}>
                              <Input
                                id={`d-${r.key}`}
                                name="description"
                                defaultValue={r.description ?? ''}
                                maxLength={300}
                              />
                            </Field>
                            <label className="flex items-center gap-2.5 text-sm">
                              <input
                                type="checkbox"
                                name="isStaff"
                                defaultChecked={r.isStaff}
                                className="accent-[var(--color-teal)]"
                              />{' '}
                              Can sign in to this dashboard
                            </label>
                            <PermissionPicker
                              permissions={permissions}
                              checked={r.permissionKeys}
                            />
                          </ActionDialog>
                          {!r.isSystem && (
                            <ActionDialog
                              label="Delete"
                              size="sm"
                              variant="quiet"
                              danger
                              title={`Delete ${r.name}?`}
                              description={
                                r.userCount
                                  ? 'Remove this role from everyone who has it first.'
                                  : 'This can’t be undone.'
                              }
                              action={deleteRole.bind(null, r.key)}
                              submitLabel="Delete role"
                            />
                          )}
                        </span>
                      )}
                    </td>
                  ))}
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>
      <p className="mt-3 max-w-[70ch] text-sm text-muted">
        Customers and partners manage their own pets, bookings and listings without permissions
        here; the app checks ownership. Only a super admin can grant or remove the super admin role,
        and nobody can give others permissions they don’t hold.
      </p>
    </>
  );
}

function ModuleRows({
  module,
  permissions,
  roles,
}: {
  module: string;
  permissions: Permission[];
  roles: Role[];
}) {
  return (
    <>
      <tr>
        <th
          scope="rowgroup"
          colSpan={roles.length + 1}
          className="sticky left-0 bg-paper px-4 py-1.5 text-left text-xs font-medium text-muted"
        >
          {MODULE_LABELS[module] ?? humanize(module)}
        </th>
      </tr>
      {permissions.map((p) => (
        <tr key={p.key} className="border-b border-line-soft">
          <th scope="row" className="sticky left-0 bg-panel px-4 py-2 text-left font-normal">
            {p.description ?? p.key}
          </th>
          {roles.map((r) => {
            const has = r.key === 'SUPER_ADMIN' || r.permissionKeys.includes(p.key);
            return (
              <td key={r.key} className="px-2 py-2">
                {has ? (
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-full bg-teal"
                    role="img"
                    aria-label="Allowed"
                  />
                ) : (
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-full border border-line"
                    role="img"
                    aria-label="Not allowed"
                  />
                )}
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}
