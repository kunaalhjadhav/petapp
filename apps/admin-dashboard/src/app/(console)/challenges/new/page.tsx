import type { Metadata } from 'next';
import { PERMISSIONS } from '@petapp/types';
import { api, apiPage } from '@/lib/api';
import { can, getMe } from '@/lib/me';
import { NoAccess, PageHeader } from '@/components/ui';
import { ChallengeForm } from './form';

export const metadata: Metadata = { title: 'New challenge' };

export default async function NewChallengePage() {
  const me = await getMe();
  if (!can(me, PERMISSIONS.CHALLENGES_MANAGE)) return <NoAccess what="challenges" />;
  const [badges, contests] = await Promise.all([
    api<Array<{ id: string; name: string }>>('/admin/badges'),
    apiPage<{ id: string; title: string; status: string }>('/admin/contests', { limit: 100 }),
  ]);
  return (
    <>
      <PageHeader
        back={{ href: '/challenges', label: 'Challenges' }}
        title="New challenge"
        description="Saved as a draft; publish it when it’s ready."
      />
      <ChallengeForm
        badges={badges}
        contests={contests.items.filter((c) => !['COMPLETED', 'CANCELLED'].includes(c.status))}
      />
    </>
  );
}
