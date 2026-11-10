import type { Metadata } from 'next';
import { PERMISSIONS } from '@petapp/types';
import { api } from '@/lib/api';
import { can, getMe } from '@/lib/me';
import { timeAgo } from '@/lib/format';
import type { Flag, Setting } from '@/lib/types';
import { NoAccess, PageHeader, Panel, Tag, inputClass } from '@/components/ui';
import { InlineForm, SubmitButton, ToggleForm } from '@/components/forms';
import { setFlag, setSetting } from './actions';
import { FLAG_LABELS as FLAGS, SETTING_LABELS as SETTINGS } from '@/lib/labels';

export const metadata: Metadata = { title: 'Features & settings' };

export default async function SettingsPage() {
  const me = await getMe();
  if (!can(me, PERMISSIONS.SETTINGS_READ)) return <NoAccess what="features and settings" />;
  const [flags, settings] = await Promise.all([
    api<Flag[]>('/admin/flags'),
    api<Setting[]>('/admin/settings'),
  ]);
  const canFlags = can(me, PERMISSIONS.FLAGS_MANAGE);
  const canSettings = can(me, PERMISSIONS.SETTINGS_MANAGE);
  const ordered = Object.keys(FLAGS)
    .map((k) => flags.find((f) => f.key === k))
    .filter((f): f is Flag => Boolean(f));

  return (
    <>
      <PageHeader
        title="Features & settings"
        description="Switch app features on or off without a new release, and adjust limits. Every change is recorded in the audit log."
      />

      <div className="flex flex-col gap-6">
        <Panel title="Features">
          <ul className="divide-y divide-line-soft">
            {ordered.map((f) => {
              const meta = FLAGS[f.key];
              return (
                <li key={f.key} className="flex items-center justify-between gap-6 px-4 py-3">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      {meta.name}
                      <Tag>{meta.phase}</Tag>
                    </p>
                    <p className="text-sm text-muted">{meta.about}</p>
                    <p className="text-xs text-faint">Last changed {timeAgo(f.updatedAt)}</p>
                  </div>
                  {canFlags ? (
                    <ToggleForm
                      action={setFlag.bind(null, f.key)}
                      checked={f.enabled}
                      label={`${meta.name} ${f.enabled ? 'on' : 'off'}`}
                    />
                  ) : (
                    <Tag tone={f.enabled ? 'good' : 'neutral'}>{f.enabled ? 'On' : 'Off'}</Tag>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="border-t border-line-soft px-4 py-2 text-xs text-muted">
            A feature only works once its phase has been built. Turning on a flag for an unbuilt
            phase has no effect in the app.
          </p>
        </Panel>

        <Panel title="Settings">
          <ul className="divide-y divide-line-soft">
            {settings
              .filter((s) => SETTINGS[s.key])
              .map((s) => {
                const meta = SETTINGS[s.key];
                return (
                  <li
                    key={s.key}
                    className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                  >
                    <label htmlFor={`s-${s.key}`} className="text-sm font-medium">
                      {meta.name}
                    </label>
                    {canSettings ? (
                      <InlineForm
                        action={setSetting.bind(null, s.key, meta.kind)}
                        className="flex items-center gap-2"
                      >
                        <input
                          id={`s-${s.key}`}
                          name="value"
                          type={meta.kind === 'number' ? 'number' : 'text'}
                          min={meta.kind === 'number' ? 0 : undefined}
                          defaultValue={String(s.value)}
                          className={`${inputClass} ${meta.kind === 'number' ? 'w-24' : 'w-64'}`}
                        />
                        {meta.suffix && <span className="text-sm text-muted">{meta.suffix}</span>}
                        <SubmitButton variant="secondary" size="sm">
                          Save
                        </SubmitButton>
                      </InlineForm>
                    ) : (
                      <span className="text-sm">{String(s.value)}</span>
                    )}
                  </li>
                );
              })}
          </ul>
        </Panel>
      </div>
    </>
  );
}
