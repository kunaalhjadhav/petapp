import Link from 'next/link';
import type { Metadata } from 'next';
import { PERMISSIONS } from '@petapp/types';
import { api } from '@/lib/api';
import { can, getMe } from '@/lib/me';
import { HOME_KINDS } from '@/lib/labels';
import type { HomeSection, Setting, Species } from '@/lib/types';
import { Empty, NoAccess, PageHeader, Panel, Tag, inputClass } from '@/components/ui';
import { ActionDialog, InlineForm, SubmitButton, ToggleForm } from '@/components/forms';
import { Table, Td } from '@/components/table';
import { createSection, moveSection, saveRecoSettings, setSectionActive } from './actions';
import { audience, schedule } from './describe';

export const metadata: Metadata = { title: 'Home screen' };

export default async function HomeScreenPage() {
  const me = await getMe();
  if (!can(me, PERMISSIONS.SETTINGS_READ)) return <NoAccess what="the home screen" />;
  const [sections, species, settings] = await Promise.all([
    api<HomeSection[]>('/admin/home-sections'),
    api<Species[]>('/admin/species'),
    api<Setting[]>('/admin/settings'),
  ]);
  const manage = can(me, PERMISSIONS.HOME_MANAGE);
  const order = sections.map((s) => s.id);
  const setting = <T,>(key: string, fallback: T) =>
    (settings.find((x) => x.key === key)?.value as T | undefined) ?? fallback;
  const reco = {
    personalised: setting('reco.personalisationEnabled', true),
    historyDays: setting('reco.historyDays', 90),
  };

  return (
    <>
      <PageHeader
        title="Home screen"
        description="The sections of the customer app’s home screen, in order. Each section fills itself for the person looking (their pets, location and history) and is left out when it has nothing to show. Pin items to show them first."
        actions={
          <>
            <Link href="/home-screen/preview" className="text-sm text-teal hover:underline">
              Preview
            </Link>
            {manage && (
              <ActionDialog
                label="Add section"
                title="Add a section"
                description="It is added at the end and is live straight away. You can move it, schedule it or limit it to some cities afterwards."
                action={createSection}
                submitLabel="Add section"
                variant="primary"
              >
                <label className="flex flex-col gap-1.5 text-sm font-medium">
                  What it shows
                  <select name="kind" required className={inputClass} defaultValue="">
                    <option value="" disabled>
                      Choose…
                    </option>
                    {Object.entries(HOME_KINDS).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1.5 text-sm font-medium">
                  Title
                  <input
                    name="title"
                    required
                    minLength={2}
                    maxLength={60}
                    className={inputClass}
                    placeholder="e.g. Monsoon picks"
                  />
                </label>
                <label className="flex flex-col gap-1.5 text-sm font-medium">
                  Subtitle (optional)
                  <input name="subtitle" maxLength={120} className={inputClass} />
                </label>
              </ActionDialog>
            )}
          </>
        }
      />

      <Panel className="mb-6">
        {sections.length === 0 ? (
          <Empty title="No sections">The app shows only the feed until you add one.</Empty>
        ) : (
          <Table head={['', 'Section', 'Shows', 'For', 'When', 'Pinned', 'In the app']}>
            {sections.map((s, i) => (
              <tr key={s.id} className="align-top">
                <Td className="whitespace-nowrap">
                  <span className="flex items-center gap-1">
                    <span className="w-5 text-right tabular-nums text-muted">{i + 1}</span>
                    {manage && (
                      <>
                        <InlineForm action={moveSection.bind(null, order, s.id, -1)}>
                          <button
                            type="submit"
                            disabled={i === 0}
                            aria-label={`Move ${s.title} up`}
                            className="rounded px-1.5 text-muted hover:bg-paper hover:text-ink disabled:opacity-30"
                          >
                            ↑
                          </button>
                        </InlineForm>
                        <InlineForm action={moveSection.bind(null, order, s.id, 1)}>
                          <button
                            type="submit"
                            disabled={i === sections.length - 1}
                            aria-label={`Move ${s.title} down`}
                            className="rounded px-1.5 text-muted hover:bg-paper hover:text-ink disabled:opacity-30"
                          >
                            ↓
                          </button>
                        </InlineForm>
                      </>
                    )}
                  </span>
                </Td>
                <Td>
                  <Link
                    href={`/home-screen/${s.id}`}
                    className={`font-medium hover:underline ${s.isActive ? '' : 'text-muted'}`}
                  >
                    {s.title}
                  </Link>
                  {s.subtitle && <p className="text-xs text-muted">{s.subtitle}</p>}
                </Td>
                <Td className="whitespace-nowrap">{HOME_KINDS[s.kind]?.name ?? s.kind}</Td>
                <Td className="text-sm">{audience(s, species)}</Td>
                <Td className="text-sm">{schedule(s)}</Td>
                <Td className="tabular-nums">
                  {s.pinsAllowed ? (
                    s.pins.length ? (
                      s.pins.length
                    ) : (
                      '—'
                    )
                  ) : (
                    <span className="text-xs text-muted">Personal</span>
                  )}
                </Td>
                <Td>
                  {manage ? (
                    <ToggleForm
                      name="isActive"
                      action={setSectionActive.bind(null, s.id)}
                      checked={s.isActive}
                      label={`Show ${s.title} in the app`}
                    />
                  ) : s.isActive ? (
                    <Tag tone="good">Shown</Tag>
                  ) : (
                    <Tag>Hidden</Tag>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>

      <Panel title="Recommendations">
        {can(me, PERMISSIONS.SETTINGS_MANAGE) ? (
          <InlineForm
            action={saveRecoSettings.bind(null, reco)}
            className="flex flex-col gap-4 px-4 py-4"
          >
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                name="personalised"
                defaultChecked={reco.personalised}
                className="mt-0.5 accent-[var(--color-teal)]"
              />
              <span>
                Personalise recommendations
                <span className="block text-xs text-muted">
                  From each person’s pets, purchases, bookings, contest entries, follows, likes and
                  what they look at. Off: everyone sees popular and nearby items. People can also
                  turn it off for themselves in the app.
                </span>
              </span>
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">
              Keep viewing history for (days)
              <input
                name="historyDays"
                type="number"
                min={1}
                max={365}
                defaultValue={reco.historyDays}
                className={`${inputClass} max-w-24`}
              />
              <span className="text-xs font-normal text-muted">
                Older views are deleted every night.
              </span>
            </label>
            <div>
              <SubmitButton>Save</SubmitButton>
            </div>
          </InlineForm>
        ) : (
          <p className="px-4 py-4 text-sm text-muted">
            Personalisation is {reco.personalised ? 'on' : 'off'}; viewing history is kept for{' '}
            {reco.historyDays} days.
          </p>
        )}
      </Panel>
    </>
  );
}
