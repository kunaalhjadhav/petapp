import type { Metadata } from 'next';
import { PERMISSIONS } from '@petapp/types';
import { api } from '@/lib/api';
import { can, getMe } from '@/lib/me';
import type { ContestCategory } from '@/lib/types';
import { Empty, Field, Input, NoAccess, PageHeader, Panel } from '@/components/ui';
import { ActionDialog, ToggleForm } from '@/components/forms';
import { saveCategory } from '../actions';

export const metadata: Metadata = { title: 'Contest categories' };

export default async function CategoriesPage() {
  const me = await getMe();
  if (!can(me, PERMISSIONS.CONTESTS_READ)) return <NoAccess what="contest categories" />;
  const cats = await api<ContestCategory[]>('/admin/contest-categories');
  const groups = [...new Set(cats.map((c) => c.group))];
  const manage = can(me, PERMISSIONS.CONTESTS_MANAGE);
  return (
    <>
      <PageHeader
        back={{ href: '/contests', label: 'Contests' }}
        title="Contest categories"
        description="Groups such as Beauty and Talent, each with categories such as Best Groomed Pet."
        actions={
          manage && (
            <ActionDialog
              label="Add category"
              variant="primary"
              title="Add a category"
              action={saveCategory.bind(null, null)}
              submitLabel="Add category"
            >
              <Field label="Name" htmlFor="cname">
                <Input
                  id="cname"
                  name="name"
                  required
                  maxLength={60}
                  placeholder="Best Groomed Pet"
                />
              </Field>
              <Field
                label="Group"
                htmlFor="cgroup"
                hint="BEAUTY, TALENT, FUN, PHOTOGRAPHY, SKILLS, CHALLENGE, or a new one"
              >
                <Input id="cgroup" name="group" required list="groups" placeholder="BEAUTY" />
              </Field>
              <datalist id="groups">
                {['BEAUTY', 'TALENT', 'FUN', 'PHOTOGRAPHY', 'SKILLS', 'CHALLENGE', ...groups]
                  .filter((g, i, a) => a.indexOf(g) === i)
                  .map((g) => (
                    <option key={g} value={g} />
                  ))}
              </datalist>
            </ActionDialog>
          )
        }
      />
      {cats.length === 0 ? (
        <Panel>
          <Empty title="No categories yet">
            Add Beauty, Talent, Fun and so on so contests can be grouped in the app.
          </Empty>
        </Panel>
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          {groups.map((g) => (
            <Panel key={g} title={g.charAt(0) + g.slice(1).toLowerCase()}>
              <ul className="divide-y divide-line-soft">
                {cats
                  .filter((c) => c.group === g)
                  .map((c) => (
                    <li key={c.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                      <span className={`text-sm ${c.isActive ? '' : 'text-muted line-through'}`}>
                        {c.name}
                      </span>
                      {manage && (
                        <ToggleForm
                          name="isActive"
                          action={async (prev, fd) => {
                            'use server';
                            fd.set('name', c.name);
                            fd.set('group', c.group);
                            fd.set('key', c.key);
                            return saveCategory(c.id, prev, fd);
                          }}
                          checked={c.isActive}
                          label={`Show ${c.name} in the app`}
                        />
                      )}
                    </li>
                  ))}
              </ul>
            </Panel>
          ))}
        </div>
      )}
    </>
  );
}
