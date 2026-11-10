import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { PERMISSIONS } from '@petapp/types';
import { api } from '@/lib/api';
import { can, getMe } from '@/lib/me';
import type { ContestDetail } from '@/lib/types';
import { NoAccess, PageHeader } from '@/components/ui';
import { ContestForm } from '../../contest-form';
import { builderData } from '../../form-data';

export const metadata: Metadata = { title: 'Edit contest' };

export default async function EditContestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await getMe();
  if (!can(me, PERMISSIONS.CONTESTS_MANAGE)) return <NoAccess what="the contest builder" />;
  const contest = await api<ContestDetail>(`/admin/contests/${id}`);
  if (contest.status !== 'DRAFT' && contest.status !== 'REVIEW') redirect(`/contests/${id}`);
  return (
    <>
      <PageHeader
        back={{ href: `/contests/${id}`, label: contest.title }}
        title="Edit contest"
        description={
          contest.feePaise ? 'Changing the entry fee clears any recorded legal review.' : undefined
        }
      />
      <ContestForm contest={contest} {...await builderData()} />
    </>
  );
}
