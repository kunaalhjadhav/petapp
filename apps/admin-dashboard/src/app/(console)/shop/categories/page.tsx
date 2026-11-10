import type { Metadata } from 'next';
import { PERMISSIONS } from '@petapp/types';
import { api } from '@/lib/api';
import { can, getMe } from '@/lib/me';
import type { ProductCategoryRow } from '@/lib/types';
import { Empty, Field, Input, NoAccess, PageHeader, Panel, Select } from '@/components/ui';
import { ActionDialog, ToggleForm } from '@/components/forms';
import { Table, Td } from '@/components/table';
import { saveCategory } from '../actions';

export const metadata: Metadata = { title: 'Product categories' };

export default async function CategoriesPage() {
  const me = await getMe();
  if (!can(me, PERMISSIONS.MARKETPLACE_READ)) return <NoAccess what="product categories" />;
  const cats = await api<ProductCategoryRow[]>('/admin/product-categories');
  const parents = cats.filter((c) => !c.parentId);
  const ordered = parents.flatMap((p) => [p, ...cats.filter((c) => c.parentId === p.id)]);
  const manage = can(me, PERMISSIONS.MARKETPLACE_MANAGE);
  const fields = (c?: ProductCategoryRow) => (
    <>
      <Field label="Name" htmlFor={`n-${c?.id ?? 'new'}`}>
        <Input
          id={`n-${c?.id ?? 'new'}`}
          name="name"
          required
          maxLength={60}
          defaultValue={c?.name}
          placeholder="Dog food"
        />
      </Field>
      {c && <input type="hidden" name="key" value={c.key} />}
      <Field label="Inside" htmlFor={`p-${c?.id ?? 'new'}`} hint="One level of nesting">
        <Select id={`p-${c?.id ?? 'new'}`} name="parentId" defaultValue={c?.parentId ?? ''}>
          <option value="">Top level</option>
          {parents
            .filter((p) => p.id !== c?.id)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
        </Select>
      </Field>
      <Field
        label="Commission (%)"
        htmlFor={`c-${c?.id ?? 'new'}`}
        hint="Standard rate for products here; a vendor’s agreed rate overrides it"
      >
        <Input
          id={`c-${c?.id ?? 'new'}`}
          name="pct"
          required
          inputMode="decimal"
          defaultValue={c ? String(c.commissionBps / 100) : '10'}
        />
      </Field>
    </>
  );
  return (
    <>
      <PageHeader
        title="Product categories"
        description="How the shop is organised, and PetApp’s standard commission for each."
        actions={
          manage && (
            <ActionDialog
              label="Add category"
              variant="primary"
              title="Add a category"
              action={saveCategory.bind(null, null)}
              submitLabel="Add"
            >
              {fields()}
            </ActionDialog>
          )
        }
      />
      <Panel>
        {ordered.length === 0 ? (
          <Empty title="No categories yet">Add Food, Treats, Toys, Grooming and so on.</Empty>
        ) : (
          <Table head={['Category', 'Commission', 'Products', 'In the shop', '']}>
            {ordered.map((c) => (
              <tr key={c.id}>
                <Td className={c.parentId ? 'pl-10' : 'font-medium'}>
                  {c.parentId ? `↳ ${c.name}` : c.name}
                </Td>
                <Td>{c.commissionBps / 100}%</Td>
                <Td>{c._count.products}</Td>
                <Td>
                  {manage ? (
                    <ToggleForm
                      name="isActive"
                      action={async (prev, fd) => {
                        'use server';
                        fd.set('name', c.name);
                        fd.set('key', c.key);
                        fd.set('pct', String(c.commissionBps / 100));
                        if (c.parentId) fd.set('parentId', c.parentId);
                        return saveCategory(c.id, prev, fd);
                      }}
                      checked={c.isActive}
                      label={`Show ${c.name} in the shop`}
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
                      label="Edit"
                      size="sm"
                      variant="quiet"
                      title={`Edit ${c.name}`}
                      action={saveCategory.bind(null, c.id)}
                      submitLabel="Save"
                    >
                      {fields(c)}
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
