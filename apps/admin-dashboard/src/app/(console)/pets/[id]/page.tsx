import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PERMISSIONS } from '@petapp/types';
import { ApiError, api } from '@/lib/api';
import { can, getMe } from '@/lib/me';
import { formatAge, formatDate, formatNumber, humanize, initials } from '@/lib/format';
import type { PetDetail } from '@/lib/types';
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
import { setPetStatus, setPetVerified } from '../actions';

export const metadata: Metadata = { title: 'Pet' };

const visibility = {
  PUBLIC: 'Everyone',
  FOLLOWERS: 'Followers only',
  PRIVATE: 'Only the owner',
} as const;

export default async function PetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await getMe();
  if (!can(me, PERMISSIONS.PETS_READ_ANY)) return <NoAccess what="pets" />;
  let p: PetDetail;
  try {
    p = await api<PetDetail>(`/admin/pets/${id}`);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 400)) notFound();
    throw e;
  }
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <PageHeader
        back={{ href: '/pets', label: 'Pets' }}
        title={
          <span className="flex flex-wrap items-center gap-3">
            <Monogram text={initials(p.name)} size={40} tone="warm" />
            <span>{p.name}</span>
            {p.isVerified && <Tag tone="teal">Verified</Tag>}
            <StatusTag status={p.status} />
          </span>
        }
        description={`@${p.handle}`}
        actions={
          <>
            {can(me, PERMISSIONS.PETS_VERIFY) && (
              <ActionDialog
                key={`verify-${p.isVerified}`}
                label={p.isVerified ? 'Remove verification' : 'Verify'}
                variant={p.isVerified ? 'secondary' : 'primary'}
                title={p.isVerified ? `Remove verification from ${p.name}?` : `Verify ${p.name}?`}
                description={
                  p.isVerified
                    ? 'The verified mark disappears from this profile in the app.'
                    : 'Verified pets show a mark on their profile. Verify only after checking the owner’s documents.'
                }
                action={setPetVerified.bind(null, p.id, !p.isVerified)}
                submitLabel={p.isVerified ? 'Remove verification' : 'Verify'}
              />
            )}
            {can(me, PERMISSIONS.PETS_MODERATE) && (
              <ActionDialog
                key={`status-${p.status}`}
                label="Change status"
                variant={p.status === 'ACTIVE' ? 'danger' : 'primary'}
                danger={p.status === 'ACTIVE'}
                title="Change pet status"
                description="Hidden profiles are visible only to their owner. Removed profiles disappear for everyone, including the owner."
                action={setPetStatus.bind(null, p.id)}
                submitLabel="Change status"
              >
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="st" className="text-sm font-medium">
                    New status
                  </label>
                  <Select
                    id="st"
                    name="status"
                    defaultValue={p.status === 'ACTIVE' ? 'HIDDEN' : 'ACTIVE'}
                  >
                    <option value="ACTIVE">Active: visible as the owner chose</option>
                    <option value="HIDDEN">Hidden: only the owner can see it</option>
                    <option value="REMOVED">Removed: gone for everyone</option>
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
                    placeholder="Which report or rule this is about"
                  />
                </div>
              </ActionDialog>
            )}
          </>
        }
      />

      <div className="grid gap-8 lg:grid-cols-[1fr_18rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <Panel title="Profile">
            <Facts
              items={[
                ['Species', `${p.species.name}${p.breed ? `, ${p.breed.name}` : ''}`],
                ['Gender', humanize(p.gender)],
                [
                  'Age',
                  p.dateOfBirth
                    ? `${formatAge(p.ageMonths)} (born ${formatDate(p.dateOfBirth)})`
                    : '—',
                ],
                ['Weight', p.weightKg ? `${p.weightKg} kg` : '—'],
                ['Colour', p.color ?? '—'],
                ['City', p.city ?? '—'],
                ['Profile visible to', visibility[p.visibility]],
                ['Followers', formatNumber(p.followerCount)],
                [
                  'Owner',
                  <Link key="o" href={`/users/${p.owner.id}`} className="text-teal hover:underline">
                    {p.owner.name ?? 'No name'}
                  </Link>,
                ],
                ['Created', formatDate(p.createdAt)],
              ]}
            />
            {(p.about || p.personality.length > 0) && (
              <div className="border-t border-line-soft px-4 py-4">
                {p.about && <p className="max-w-[65ch] text-sm">{p.about}</p>}
                {p.personality.length > 0 && (
                  <p className="mt-2 flex flex-wrap gap-1.5">
                    {p.personality.map((t) => (
                      <Tag key={t}>{t}</Tag>
                    ))}
                  </p>
                )}
              </div>
            )}
          </Panel>

          <Panel title="Private to the owner">
            <p className="px-4 pt-3 text-xs text-muted">
              Staff can see these fields to help the owner. They are never shown to other app users.
            </p>
            <Facts
              items={[
                ['Microchip', p.microchipId ?? '—'],
                ['Medical notes', p.medicalNotes ?? '—'],
              ]}
            />
            <div className="border-t border-line-soft">
              <p className="px-4 pt-3 text-sm font-medium">Vaccinations</p>
              {p.vaccinations.length === 0 ? (
                <p className="px-4 pb-4 pt-1 text-sm text-muted">None recorded.</p>
              ) : (
                <ul className="divide-y divide-line-soft px-4 pb-2">
                  {p.vaccinations.map((v) => {
                    const expired = v.validUntil && v.validUntil.slice(0, 10) < today;
                    return (
                      <li
                        key={v.id}
                        className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
                      >
                        <span>
                          {v.name}
                          {v.givenOn && (
                            <span className="text-muted">, given {formatDate(v.givenOn)}</span>
                          )}
                        </span>
                        {v.validUntil && (
                          <Tag tone={expired ? 'warn' : 'good'}>
                            {expired
                              ? `Expired ${formatDate(v.validUntil)}`
                              : `Valid until ${formatDate(v.validUntil)}`}
                          </Tag>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </Panel>
        </div>
        <Trail entityType="Pet" entityId={p.id} />
      </div>
    </>
  );
}
