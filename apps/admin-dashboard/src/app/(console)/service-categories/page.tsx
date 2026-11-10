import type { Metadata } from 'next';
import { PERMISSIONS } from '@petapp/types';
import { api } from '@/lib/api';
import { can, getMe } from '@/lib/me';
import { bpsToPct } from '@/lib/labels';
import type { ServiceCategoryRow } from '@/lib/types';
import { Empty, Field, Input, NoAccess, PageHeader, Panel } from '@/components/ui';
import { ActionDialog, ToggleForm } from '@/components/forms';
import { Table, Td } from '@/components/table';
import { saveServiceCategory } from '../partners/actions';

export const metadata: Metadata = { title: 'Service categories' };

export default async function ServiceCategoriesPage() {
  const me = await getMe();
  if (!can(me, PERMISSIONS.PARTNERS_READ)) return <NoAccess what="service categories" />;
  const cats = await api<ServiceCategoryRow[]>('/admin/service-categories');
  const manage = can(me, PERMISSIONS.SERVICES_MANAGE);
  return (
    <>
      <PageHeader
        title="Service categories"
        description="What customers can search for, and the platform commission on each. A partner can have a custom rate."
        actions={
          manage && (
            <ActionDialog
              label="Add category"
              variant="primary"
              title="Add a service category"
              action={saveServiceCategory.bind(null, null)}
              submitLabel="Add category"
            >
              <Field label="Name" htmlFor="sc-name">
                <Input id="sc-name" name="name" required maxLength={60} placeholder="Grooming" />
              </Field>
              <Field label="Commission (%)" htmlFor="sc-pct" hint="0–50. Default 15.">
                <Input id="sc-pct" name="pct" inputMode="decimal" placeholder="15" />
              </Field>
            </ActionDialog>
          )
        }
      />
      <Panel>
        {cats.length === 0 ? (
          <Empty title="No categories yet">
            Add Grooming, Vet consultation, Training, Boarding, Walking and so on.
          </Empty>
        ) : (
          <Table head={['Category', 'Commission', 'Shown in the app', '']}>
            {cats.map((c) => (
              <tr key={c.id}>
                <Td className={c.isActive ? 'font-medium' : 'font-medium text-muted line-through'}>
                  {c.name}
                </Td>
                <Td>{bpsToPct(c.commissionBps)}</Td>
                <Td>
                  {manage ? (
                    <ToggleForm
                      name="isActive"
                      action={async (prev, fd) => {
                        'use server';
                        fd.set('key', c.key);
                        fd.set('name', c.name);
                        return saveServiceCategory(c.id, prev, fd);
                      }}
                      checked={c.isActive}
                      label={`Show ${c.name} in the app`}
                    />
                  ) : c.isActive ? (
                    'Yes'
                  ) : (
                    'No'
                  )}
                </Td>
                <Td>
                  {manage && (
                    <ActionDialog
                      label="Change commission"
                      size="sm"
                      variant="quiet"
                      title={`Commission for ${c.name}`}
                      description="Applies to new bookings. Existing bookings keep the rate they were made at."
                      action={saveServiceCategory.bind(null, c.id)}
                      submitLabel="Save"
                    >
                      <input type="hidden" name="key" value={c.key} />
                      <input type="hidden" name="name" value={c.name} />
                      <Field label="Commission (%)" htmlFor={`p-${c.id}`}>
                        <Input
                          id={`p-${c.id}`}
                          name="pct"
                          inputMode="decimal"
                          defaultValue={String(c.commissionBps / 100)}
                          required
                        />
                      </Field>
                    </ActionDialog>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>
    </>
  );
}
