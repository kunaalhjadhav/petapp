import type { Metadata } from 'next';
import { PERMISSIONS } from '@petapp/types';
import { can, getMe } from '@/lib/me';
import { NoAccess, PageHeader } from '@/components/ui';
import { ContestForm } from '../contest-form';
import { builderData } from '../form-data';

export const metadata: Metadata = { title: 'New contest' };

export default async function NewContestPage() {
  const me = await getMe();
  if (!can(me, PERMISSIONS.CONTESTS_MANAGE)) return <NoAccess what="the contest builder" />;
  return (
    <>
      <PageHeader
        back={{ href: '/contests', label: 'Contests' }}
        title="New contest"
        description="Saved as a draft. Nothing is visible in the app until it’s scheduled."
      />
      <ContestForm {...await builderData()} />
    </>
  );
}
