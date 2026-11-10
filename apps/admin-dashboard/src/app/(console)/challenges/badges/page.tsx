import type { Metadata } from 'next';
import { PERMISSIONS } from '@petapp/types';
import { api } from '@/lib/api';
import { can, getMe } from '@/lib/me';
import { Empty, Field, Input, NoAccess, PageHeader, Panel } from '@/components/ui';
import { ActionDialog } from '@/components/forms';
import { Table, Td } from '@/components/table';
import { createBadge } from '../actions';

export const metadata: Metadata = { title: 'Badges' };

export default async function BadgesPage() {
  const me = await getMe();
  if (!can(me, PERMISSIONS.CONTESTS_READ)) return <NoAccess what="badges" />;
  const badges =
    await api<
      Array<{ id: string; name: string; description: string; _count: { awarded: number } }>
    >('/admin/badges');
  return (
    <>
      <PageHeader
        back={{ href: '/challenges', label: 'Challenges' }}
        title="Badges"
        description="Earned by completing challenges. Shown on people’s profiles."
        actions={
          can(me, PERMISSIONS.CHALLENGES_MANAGE) && (
            <ActionDialog
              label="Add badge"
              variant="primary"
              title="Add a badge"
              action={createBadge}
              submitLabel="Add badge"
            >
              <Field label="Name" htmlFor="bname">
                <Input id="bname" name="name" required maxLength={60} placeholder="7-Day Walker" />
              </Field>
              <Field label="Description" htmlFor="bdesc">
                <Input
                  id="bdesc"
                  name="description"
                  required
                  minLength={5}
                  maxLength={300}
                  placeholder="Walked seven days in a row."
                />
              </Field>
            </ActionDialog>
          )
        }
      />
      <Panel>
        {badges.length === 0 ? (
          <Empty title="No badges yet" />
        ) : (
          <Table head={['Badge', 'Description', 'Awarded']}>
            {badges.map((b) => (
              <tr key={b.id}>
                <Td className="font-medium">{b.name}</Td>
                <Td className="text-muted">{b.description}</Td>
                <Td>{b._count.awarded}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>
    </>
  );
}
