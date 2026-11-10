'use client';

import { useActionState, useEffect, useState, type ReactNode } from 'react';
import { ErrorNote, inputClass } from '@/components/ui';
import { PendingContext, SubmitButton, keepValues } from '@/components/forms';
import { createChallenge } from '../actions';

const local = (h: number) => {
  const d = new Date(Date.now() + h * 3_600_000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

function L({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="font-medium">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function ChallengeForm({
  badges,
  contests,
}: {
  badges: Array<{ id: string; name: string }>;
  contests: Array<{ id: string; title: string }>;
}) {
  const [state, action, pending] = useActionState(createChallenge, null);
  const [kind, setKind] = useState('FREE');
  // The browser's offset from UTC, so the server reads the times as the admin meant them.
  const [tz, setTz] = useState(0);
  useEffect(() => setTz(new Date().getTimezoneOffset()), []);
  return (
    <PendingContext.Provider value={pending}>
      <form
        onSubmit={keepValues(action)}
        className="flex max-w-3xl flex-col gap-4 rounded-lg border border-line bg-panel p-5"
      >
        <input type="hidden" name="tzOffset" value={tz} />
        <L label="Title">
          <input
            name="title"
            required
            maxLength={100}
            className={inputClass}
            placeholder="7 Days Walking Challenge"
          />
        </L>
        <L label="Description">
          <textarea
            name="description"
            required
            minLength={10}
            rows={3}
            className={`${inputClass} h-auto py-2`}
          />
        </L>
        <div className="grid gap-3 sm:grid-cols-3">
          <L label="Who can join">
            <select
              name="kind"
              className={inputClass}
              value={kind}
              onChange={(e) => setKind(e.target.value)}
            >
              <option value="FREE">Everyone (free)</option>
              <option value="PAID">Paid entry</option>
              <option value="CONTEST_LINKED">Entrants of a contest</option>
            </select>
          </L>
          {kind === 'PAID' && (
            <L label="Fee (₹)">
              <input name="fee" required inputMode="decimal" className={inputClass} />
            </L>
          )}
          {kind === 'CONTEST_LINKED' && (
            <L label="Contest">
              <select name="contestId" required className={inputClass}>
                {contests.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
            </L>
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <L label="Starts">
            <input
              type="datetime-local"
              name="startsAt"
              required
              defaultValue={local(1)}
              className={inputClass}
            />
          </L>
          <L label="Ends">
            <input
              type="datetime-local"
              name="endsAt"
              required
              defaultValue={local(24 * 8)}
              className={inputClass}
            />
          </L>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <L label="Check-ins to complete" hint="One per day, India time">
            <input
              type="number"
              name="requiredCheckIns"
              required
              min={1}
              max={365}
              defaultValue={7}
              className={inputClass}
            />
          </L>
          <L label="Proof for each check-in">
            <select name="proof" className={inputClass} defaultValue="POST">
              <option value="NONE">None (just tap)</option>
              <option value="POST">A post</option>
              <option value="TEXT">A short note</option>
            </select>
          </L>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <L label="Points per check-in">
            <input
              type="number"
              name="pointsPerCheckIn"
              min={0}
              defaultValue={10}
              className={inputClass}
            />
          </L>
          <L label="Bonus every … days in a row" hint="0 = no bonus">
            <input
              type="number"
              name="streakBonusEvery"
              min={0}
              defaultValue={7}
              className={inputClass}
            />
          </L>
          <L label="Bonus points">
            <input
              type="number"
              name="streakBonusPoints"
              min={0}
              defaultValue={50}
              className={inputClass}
            />
          </L>
        </div>
        <L label="Badge on completion">
          <select name="badgeId" className={inputClass} defaultValue="">
            <option value="">None</option>
            {badges.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </L>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="membersOnly" /> Premium challenge: members only (plans with “Premium challenges”)
        </label>
        {state && !state.ok && <ErrorNote>{state.message}</ErrorNote>}
        <div>
          <SubmitButton>Create draft</SubmitButton>
        </div>
      </form>
    </PendingContext.Provider>
  );
}
