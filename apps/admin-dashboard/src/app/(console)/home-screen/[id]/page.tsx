import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PERMISSIONS } from '@petapp/types';
import { ApiError, api } from '@/lib/api';
import { can, getMe } from '@/lib/me';
import { formatDateTime } from '@/lib/format';
import { HOME_KINDS } from '@/lib/labels';
import type { HomeSection, Species } from '@/lib/types';
import { NoAccess, PageHeader, Panel, Tag, inputClass } from '@/components/ui';
import { ActionDialog, InlineForm, SubmitButton, ToggleForm } from '@/components/forms';
import { LocalDateTime } from '@/components/local-datetime';
import { addPin, deleteSection, removePin, saveSection, setSectionActive } from '../actions';
import { audience, schedule } from '../describe';

export const metadata: Metadata = { title: 'Home screen section' };

export default async function SectionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await getMe();
  if (!can(me, PERMISSIONS.SETTINGS_READ)) return <NoAccess what="the home screen" />;
  let s: HomeSection;
  try {
    s = await api<HomeSection>(`/admin/home-sections/${id}`);
  } catch (e) {
    if (e instanceof ApiError && (e.status === 404 || e.status === 400)) notFound();
    throw e;
  }
  const species = (await api<Species[]>('/admin/species')).filter(
    (x) => x.isActive || s.speciesIds.includes(x.id),
  );
  const manage = can(me, PERMISSIONS.HOME_MANAGE);
  const kind = HOME_KINDS[s.kind];

  return (
    <>
      <PageHeader
        back={{ href: '/home-screen', label: 'Home screen' }}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {s.title}
            {s.isActive ? <Tag tone="good">Shown</Tag> : <Tag>Hidden</Tag>}
          </span>
        }
        description={`${kind?.name ?? s.kind}: ${kind?.about ?? ''}`}
        actions={
          <>
            <Link href="/home-screen/preview" className="text-sm text-teal hover:underline">
              Preview
            </Link>
            {manage && (
              <ToggleForm
                name="isActive"
                action={setSectionActive.bind(null, s.id)}
                checked={s.isActive}
                label={`Show ${s.title} in the app`}
              />
            )}
          </>
        }
      />

      <div className="grid items-start gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <Panel title="Section">
            {manage ? (
              <InlineForm
                action={saveSection.bind(null, s.id)}
                className="flex flex-col gap-4 px-4 py-4"
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="flex flex-col gap-1.5 text-sm font-medium">
                    Title
                    <input
                      name="title"
                      required
                      minLength={2}
                      maxLength={60}
                      defaultValue={s.title}
                      className={inputClass}
                    />
                  </label>
                  <label className="flex flex-col gap-1.5 text-sm font-medium">
                    Subtitle
                    <input
                      name="subtitle"
                      maxLength={120}
                      defaultValue={s.subtitle ?? ''}
                      className={inputClass}
                    />
                  </label>
                </div>
                <label className="flex flex-col gap-1.5 text-sm font-medium">
                  Items to show
                  <input
                    name="itemLimit"
                    type="number"
                    min={1}
                    max={20}
                    required
                    defaultValue={s.itemLimit}
                    className={`${inputClass} max-w-24`}
                  />
                </label>
                <div className="grid gap-4 sm:grid-cols-2">
                  <LocalDateTime
                    name="startsAt"
                    label="Show from"
                    value={s.startsAt}
                    hint="Empty: straight away"
                  />
                  <LocalDateTime
                    name="endsAt"
                    label="Show until"
                    value={s.endsAt}
                    hint="Empty: no end"
                  />
                </div>
                <label className="flex flex-col gap-1.5 text-sm font-medium">
                  Only in these cities
                  <input
                    name="cities"
                    defaultValue={s.cities
                      .map((c) => c.replace(/\b\w/g, (x) => x.toUpperCase()))
                      .join(', ')}
                    className={inputClass}
                    placeholder="e.g. Pune, Mumbai"
                  />
                  <span className="text-xs font-normal text-muted">
                    Separate with commas. Empty: everywhere. People are matched by the city they
                    choose in the app or their saved address.
                  </span>
                </label>
                <fieldset className="flex flex-col gap-1.5">
                  <legend className="mb-1.5 text-sm font-medium">Only for people with</legend>
                  <div className="flex flex-wrap gap-x-5 gap-y-2">
                    {species.map((x) => (
                      <label key={x.id} className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          name="speciesIds"
                          value={x.id}
                          defaultChecked={s.speciesIds.includes(x.id)}
                          className="accent-[var(--color-teal)]"
                        />
                        {x.name}
                      </label>
                    ))}
                  </div>
                  <span className="text-xs text-muted">
                    None ticked: everyone, including people signed out or without pets.
                  </span>
                </fieldset>
                <div>
                  <SubmitButton>Save</SubmitButton>
                </div>
              </InlineForm>
            ) : (
              <p className="px-4 py-4 text-sm text-muted">
                Your role can view the home screen but not change it.
              </p>
            )}
          </Panel>

          <Panel title="Pinned">
            {!s.pinsAllowed ? (
              <p className="px-4 py-4 text-sm text-muted">
                This section is different for everyone (their own bookings and deadlines), so
                nothing can be pinned to it.
              </p>
            ) : (
              <>
                {s.pins.length === 0 ? (
                  <p className="px-4 py-4 text-sm text-muted">
                    {s.kind === 'PARTNER_OFFERS'
                      ? 'No offers picked yet, so this section isn’t shown. Add coupon codes below.'
                      : 'Nothing pinned. The section fills itself.'}
                  </p>
                ) : (
                  <ol className="divide-y divide-line-soft">
                    {s.pins.map((p, i) => (
                      <li
                        key={p.id}
                        className="flex items-center justify-between gap-4 px-4 py-2.5"
                      >
                        <span className="min-w-0 text-sm">
                          <span className="mr-2 tabular-nums text-muted">{i + 1}</span>
                          {p.label}
                          {!p.live && (
                            <span className="ml-2">
                              <Tag tone="warn">Not shown now</Tag>
                            </span>
                          )}
                        </span>
                        {manage && (
                          <InlineForm action={removePin.bind(null, s.id, p.id)}>
                            <button
                              type="submit"
                              className="text-sm text-danger hover:underline"
                              aria-label={`Unpin ${p.label}`}
                            >
                              Unpin
                            </button>
                          </InlineForm>
                        )}
                      </li>
                    ))}
                  </ol>
                )}
                {manage && (
                  <InlineForm
                    action={addPin.bind(null, s.id)}
                    className="flex flex-wrap items-end gap-2 border-t border-line-soft px-4 py-3"
                    resetOnSuccess
                  >
                    <label className="flex min-w-60 flex-1 flex-col gap-1.5 text-sm font-medium">
                      Pin {s.pinWhat}
                      <input
                        name="ref"
                        required
                        className={inputClass}
                        placeholder={
                          s.kind === 'PARTNER_OFFERS'
                            ? 'e.g. PAWS10'
                            : 'Paste a link, or type a slug or id'
                        }
                      />
                    </label>
                    <SubmitButton variant="secondary">Pin</SubmitButton>
                  </InlineForm>
                )}
                <p className="border-t border-line-soft px-4 py-3 text-xs text-muted">
                  Pinned items come first, in this order, then the section fills the rest itself.
                  Items that can’t be shown (ended, sold out, hidden) are skipped.
                </p>
              </>
            )}
          </Panel>
        </div>

        <Panel title="Summary">
          <dl className="flex flex-col gap-3 px-4 py-4 text-sm">
            <div>
              <dt className="text-xs text-muted">Shown to</dt>
              <dd>{audience(s, species)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">When</dt>
              <dd>{schedule(s)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Last changed</dt>
              <dd>{formatDateTime(s.updatedAt)}</dd>
            </div>
          </dl>
          {manage && (
            <div className="border-t border-line-soft px-4 py-3">
              <ActionDialog
                label="Delete section"
                title={`Delete “${s.title}”?`}
                description="It disappears from the app straight away. To bring it back you’d add it again. To hide it for now, switch it off instead."
                action={deleteSection.bind(null, s.id)}
                submitLabel="Delete"
                variant="quiet"
                danger
                size="sm"
              />
            </div>
          )}
        </Panel>
      </div>
    </>
  );
}
