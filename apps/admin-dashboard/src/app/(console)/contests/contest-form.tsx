'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition, type ReactNode } from 'react';
import type { ContestCategory, ContestDetail, Finance, Species } from '@/lib/types';
import { formatPaise, rupeesToPaise } from '@/lib/money';
import { Button, ErrorNote, Panel, inputClass } from '@/components/ui';
import { saveContest } from './actions';

type Task = { type: 'POST' | 'TEXT'; title: string; required: boolean };
type Criterion = { name: string; weight: string };
type Prize = { rank: string; title: string; kind: string; amount: string };

const PRIZE_KINDS = ['CASH', 'PRODUCT', 'VOUCHER', 'SERVICE', 'SPONSORED'];
const FINANCE_FIELDS: Array<[keyof Finance, string]> = [
  ['prizePoolPct', 'Prize pool'],
  ['platformFeePct', 'Platform fee'],
  ['gstOnPlatformFeePct', 'GST on the platform fee'],
  ['gatewayPct', 'Payment gateway'],
  ['promotionPct', 'Promotion'],
  ['refundReservePct', 'Refund reserve'],
];

/** "2026-10-05T09:30" in the browser's time zone, for <input type="datetime-local">. */
const toLocal = (iso?: string | null, fallbackHours = 0) => {
  const d = iso ? new Date(iso) : new Date(Date.now() + fallbackHours * 3_600_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <Panel title={title}>
      <div className="flex flex-col gap-4 px-4 py-4">
        {hint && <p className="-mt-1 text-sm text-muted">{hint}</p>}
        {children}
      </div>
    </Panel>
  );
}

function L({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="font-medium">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </label>
  );
}

/** Same basis-point maths as the API's financeBreakdown, for a live preview while editing. */
function preview(feePaise: number, n: number, f: Record<keyof Finance, number>) {
  const bp = (p: number) => Math.round(p * 100);
  const share = (amount: number, p: number) => Math.floor((amount * bp(p)) / 10_000);
  const gross = feePaise * n;
  const platform = share(gross, f.platformFeePct);
  const lines =
    share(gross, f.prizePoolPct) +
    platform +
    share(platform, f.gstOnPlatformFeePct) +
    share(gross, f.gatewayPct) +
    share(gross, f.promotionPct) +
    share(gross, f.refundReservePct) +
    f.judgeFeesPaise;
  return { gross, prize: share(gross, f.prizePoolPct), left: gross - lines };
}

export function ContestForm({
  contest,
  categories,
  judges,
  species,
}: {
  contest?: ContestDetail;
  categories: ContestCategory[];
  judges: Array<{ id: string; name: string | null }>;
  species: Species[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [f, setF] = useState({
    title: contest?.title ?? '',
    description: contest?.description ?? '',
    categoryId: contest?.categoryId ?? '',
    bannerUrl: contest?.bannerUrl ?? '',
    fee: contest ? String(contest.feePaise / 100) : '0',
    min: String(contest?.minParticipants ?? 0),
    max: contest?.maxParticipants ? String(contest.maxParticipants) : '',
    opens: toLocal(contest?.registrationOpensAt, 24),
    closes: toLocal(contest?.registrationClosesAt, 24 * 8),
    subs: toLocal(contest?.submissionClosesAt, 24 * 12),
    voting: toLocal(contest?.votingClosesAt, 24 * 19),
    publicWeight: contest?.publicWeight ?? 40,
    votesPerDay: String(contest?.votesPerUserPerDay ?? 1),
    minAge: String(contest?.minAccountAgeDays ?? 0),
    rules: contest?.rules ?? '',
    terms: contest?.terms ?? '',
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value });

  const [speciesIds, setSpeciesIds] = useState<string[]>(contest?.eligibleSpeciesIds ?? []);
  const [membersOnly, setMembersOnly] = useState<boolean>(contest?.membersOnly ?? false);
  const [judgeIds, setJudgeIds] = useState<string[]>(contest?.judges.map((j) => j.userId) ?? []);
  const [tasks, setTasks] = useState<Task[]>(
    contest?.tasks.map((t) => ({ type: t.type, title: t.title, required: t.required })) ?? [
      { type: 'POST', title: '', required: true },
    ],
  );
  const [criteria, setCriteria] = useState<Criterion[]>(
    contest?.criteria.map((c) => ({ name: c.name, weight: String(c.weight) })) ?? [
      { name: 'Creativity', weight: '50' },
      { name: 'Presentation', weight: '50' },
    ],
  );
  const [prizes, setPrizes] = useState<Prize[]>(
    contest?.prizes.map((p) => ({
      rank: p.rank ? String(p.rank) : '',
      title: p.title,
      kind: p.kind,
      amount: p.amountPaise ? String(p.amountPaise / 100) : '',
    })) ?? [{ rank: '1', title: '1st prize', kind: 'CASH', amount: '' }],
  );
  const [money, setMoney] = useState<Record<keyof Finance, string>>(() => {
    const src = contest?.finance;
    return {
      prizePoolPct: String(src?.prizePoolPct ?? 60),
      platformFeePct: String(src?.platformFeePct ?? 20),
      gstOnPlatformFeePct: String(src?.gstOnPlatformFeePct ?? 18),
      gatewayPct: String(src?.gatewayPct ?? 2),
      promotionPct: String(src?.promotionPct ?? 5),
      refundReservePct: String(src?.refundReservePct ?? 5),
      judgeFeesPaise: String((src?.judgeFeesPaise ?? 0) / 100),
    };
  });

  const feePaise = rupeesToPaise(f.fee);
  const paid = (feePaise ?? 0) > 0;
  const criteriaTotal = criteria.reduce((a, c) => a + (Number(c.weight) || 0), 0);
  const nums = useMemo(() => {
    const out = {} as Record<keyof Finance, number>;
    for (const [k] of FINANCE_FIELDS) out[k] = Number(money[k]) || 0;
    out.judgeFeesPaise = rupeesToPaise(money.judgeFeesPaise) ?? 0;
    return out;
  }, [money]);
  const pctOfGross =
    nums.prizePoolPct +
    nums.platformFeePct +
    nums.gatewayPct +
    nums.promotionPct +
    nums.refundReservePct +
    (nums.platformFeePct * nums.gstOnPlatformFeePct) / 100;
  const atMax = paid && Number(f.max) > 0 ? preview(feePaise!, Number(f.max), nums) : null;

  function submit() {
    setError(null);
    if (feePaise === null)
      return setError('Enter the entry fee in rupees, for example 199 or 0 for free.');
    const prizeList = [];
    for (const p of prizes) {
      const amount = p.amount.trim() ? rupeesToPaise(p.amount) : null;
      if (p.amount.trim() && amount === null)
        return setError(`Prize “${p.title}”: enter the amount in rupees.`);
      prizeList.push({
        rank: p.rank ? Number(p.rank) : undefined,
        title: p.title.trim(),
        kind: p.kind,
        amountPaise: amount ?? undefined,
      });
    }
    const payload: Record<string, unknown> = {
      title: f.title.trim(),
      description: f.description.trim(),
      categoryId: f.categoryId || undefined,
      bannerUrl: f.bannerUrl.trim() || undefined,
      feePaise,
      minParticipants: Number(f.min) || 0,
      maxParticipants: f.max ? Number(f.max) : undefined,
      registrationOpensAt: new Date(f.opens).toISOString(),
      registrationClosesAt: new Date(f.closes).toISOString(),
      submissionClosesAt: new Date(f.subs).toISOString(),
      votingClosesAt: new Date(f.voting).toISOString(),
      publicWeight: Number(f.publicWeight),
      votesPerUserPerDay: Number(f.votesPerDay) || 1,
      minAccountAgeDays: Number(f.minAge) || 0,
      eligibleSpeciesIds: speciesIds,
      membersOnly,
      rules: f.rules.trim() || undefined,
      terms: f.terms.trim() || undefined,
      tasks: tasks.filter((t) => t.title.trim()).map((t) => ({ ...t, title: t.title.trim() })),
      criteria:
        Number(f.publicWeight) < 100
          ? criteria
              .filter((c) => c.name.trim())
              .map((c) => ({ name: c.name.trim(), weight: Number(c.weight) || 0 }))
          : [],
      prizes: prizeList.filter((p) => p.title),
      judgeIds: Number(f.publicWeight) < 100 ? judgeIds : [],
      finance: paid ? nums : undefined,
    };
    start(async () => {
      const r = await saveContest(contest?.id ?? null, payload);
      if (!r?.ok) return setError(r?.message ?? 'Something went wrong.');
      router.push(`/contests/${r.id}`);
    });
  }

  const row = 'grid gap-3 sm:grid-cols-[1fr_1fr]';
  return (
    <div className="flex flex-col gap-6">
      <Section title="Basics">
        <L label="Title">
          <input
            className={inputClass}
            value={f.title}
            onChange={set('title')}
            maxLength={100}
            placeholder="Monsoon Glam Pet 2026"
          />
        </L>
        <L label="Description" hint="Shown on the contest page in the app.">
          <textarea
            className={`${inputClass} h-auto py-2`}
            rows={3}
            value={f.description}
            onChange={set('description')}
            maxLength={5000}
          />
        </L>
        <div className={row}>
          <L label="Category">
            <select className={inputClass} value={f.categoryId} onChange={set('categoryId')}>
              <option value="">None</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.group.charAt(0) + c.group.slice(1).toLowerCase()} · {c.name}
                </option>
              ))}
            </select>
          </L>
          <L label="Banner image URL" hint="https:// only">
            <input
              className={inputClass}
              value={f.bannerUrl}
              onChange={set('bannerUrl')}
              placeholder="https://…"
            />
          </L>
        </div>
      </Section>

      <Section
        title="Entry"
        hint="A fee above zero makes this a paid contest: it needs a money split and a recorded legal review before going live."
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <L label="Entry fee (₹)" hint={paid ? formatPaise(feePaise) + ' per entry' : 'Free'}>
            <input className={inputClass} inputMode="decimal" value={f.fee} onChange={set('fee')} />
          </L>
          <L label="Minimum entries" hint="Below this at voting time, cancel and refund">
            <input
              className={inputClass}
              type="number"
              min={0}
              value={f.min}
              onChange={set('min')}
            />
          </L>
          <L label="Maximum entries" hint="Leave empty for no limit">
            <input
              className={inputClass}
              type="number"
              min={1}
              value={f.max}
              onChange={set('max')}
            />
          </L>
        </div>
        <fieldset className="flex flex-col gap-2 text-sm">
          <legend className="mb-1 font-medium">Who can enter</legend>
          <label className="inline-flex items-center gap-2">
            <input type="checkbox" name="membersOnly" className="accent-[var(--color-teal)]" checked={membersOnly} onChange={(e) => setMembersOnly(e.target.checked)} />
            Members only (plans with “Members-only contests”; has no effect while Memberships are off)
          </label>
          <div className="flex flex-wrap gap-3">
            {species.map((s) => (
              <label key={s.id} className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  className="accent-[var(--color-teal)]"
                  checked={speciesIds.includes(s.id)}
                  onChange={(e) =>
                    setSpeciesIds(
                      e.target.checked
                        ? [...speciesIds, s.id]
                        : speciesIds.filter((x) => x !== s.id),
                    )
                  }
                />
                {s.name}
              </label>
            ))}
          </div>
          <span className="text-xs text-muted">
            {speciesIds.length
              ? 'Only the ticked species.'
              : 'Nothing ticked: every species can enter.'}
          </span>
        </fieldset>
      </Section>

      <Section title="Dates" hint="Must run in order. Times are in your browser’s time zone.">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <L label="Registration opens">
            <input
              type="datetime-local"
              className={inputClass}
              value={f.opens}
              onChange={set('opens')}
            />
          </L>
          <L label="Registration closes">
            <input
              type="datetime-local"
              className={inputClass}
              value={f.closes}
              onChange={set('closes')}
            />
          </L>
          <L label="Submissions close">
            <input
              type="datetime-local"
              className={inputClass}
              value={f.subs}
              onChange={set('subs')}
            />
          </L>
          <L label="Voting closes">
            <input
              type="datetime-local"
              className={inputClass}
              value={f.voting}
              onChange={set('voting')}
            />
          </L>
        </div>
      </Section>

      <Section
        title="Tasks"
        hint="What each entrant does. Post tasks take one of their published posts; text tasks take a written answer."
      >
        {tasks.map((t, i) => (
          <div key={i} className="grid items-center gap-2 sm:grid-cols-[8rem_1fr_auto_auto]">
            <select
              aria-label="Task type"
              className={inputClass}
              value={t.type}
              onChange={(e) =>
                setTasks(
                  tasks.map((x, j) =>
                    j === i ? { ...x, type: e.target.value as Task['type'] } : x,
                  ),
                )
              }
            >
              <option value="POST">Post</option>
              <option value="TEXT">Text answer</option>
            </select>
            <input
              aria-label="Task"
              className={inputClass}
              value={t.title}
              placeholder="Upload a 30-second grooming video"
              onChange={(e) =>
                setTasks(tasks.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))
              }
            />
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="accent-[var(--color-teal)]"
                checked={t.required}
                onChange={(e) =>
                  setTasks(
                    tasks.map((x, j) => (j === i ? { ...x, required: e.target.checked } : x)),
                  )
                }
              />{' '}
              Required
            </label>
            <Button
              type="button"
              size="sm"
              variant="quiet"
              onClick={() => setTasks(tasks.filter((_, j) => j !== i))}
            >
              Remove
            </Button>
          </div>
        ))}
        <div>
          <Button
            type="button"
            size="sm"
            onClick={() => setTasks([...tasks, { type: 'POST', title: '', required: true }])}
          >
            Add task
          </Button>
        </div>
      </Section>

      <Section title="Scoring">
        <L label={`Public votes ${f.publicWeight}% · Judges ${100 - Number(f.publicWeight)}%`}>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={f.publicWeight}
            onChange={(e) => setF({ ...f, publicWeight: Number(e.target.value) })}
            className="accent-[var(--color-teal)]"
          />
        </L>
        <div className="grid gap-3 sm:grid-cols-2">
          <L label="Votes per person per day">
            <input
              type="number"
              min={1}
              max={50}
              className={inputClass}
              value={f.votesPerDay}
              onChange={set('votesPerDay')}
            />
          </L>
          <L label="Minimum account age to vote (days)" hint="Slows down fake accounts">
            <input
              type="number"
              min={0}
              max={365}
              className={inputClass}
              value={f.minAge}
              onChange={set('minAge')}
            />
          </L>
        </div>
        {Number(f.publicWeight) < 100 && (
          <>
            <p className="text-sm font-medium">
              Judging criteria{' '}
              <span className={criteriaTotal === 100 ? 'text-good' : 'text-danger'}>
                (weights total {criteriaTotal} of 100)
              </span>
            </p>
            {criteria.map((c, i) => (
              <div key={i} className="grid items-center gap-2 sm:grid-cols-[1fr_7rem_auto]">
                <input
                  aria-label="Criterion"
                  className={inputClass}
                  value={c.name}
                  onChange={(e) =>
                    setCriteria(
                      criteria.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)),
                    )
                  }
                />
                <input
                  aria-label="Weight"
                  type="number"
                  min={1}
                  max={100}
                  className={inputClass}
                  value={c.weight}
                  onChange={(e) =>
                    setCriteria(
                      criteria.map((x, j) => (j === i ? { ...x, weight: e.target.value } : x)),
                    )
                  }
                />
                <Button
                  type="button"
                  size="sm"
                  variant="quiet"
                  onClick={() => setCriteria(criteria.filter((_, j) => j !== i))}
                >
                  Remove
                </Button>
              </div>
            ))}
            <div>
              <Button
                type="button"
                size="sm"
                onClick={() => setCriteria([...criteria, { name: '', weight: '' }])}
              >
                Add criterion
              </Button>
            </div>
            <fieldset className="flex flex-col gap-2 text-sm">
              <legend className="mb-1 font-medium">Judges</legend>
              {judges.length === 0 ? (
                <p className="text-muted">
                  No one has the Judge role yet. Give it to someone under People, then come back.
                </p>
              ) : (
                <div className="flex flex-wrap gap-3">
                  {judges.map((j) => (
                    <label key={j.id} className="inline-flex items-center gap-2">
                      <input
                        type="checkbox"
                        className="accent-[var(--color-teal)]"
                        checked={judgeIds.includes(j.id)}
                        onChange={(e) =>
                          setJudgeIds(
                            e.target.checked
                              ? [...judgeIds, j.id]
                              : judgeIds.filter((x) => x !== j.id),
                          )
                        }
                      />
                      {j.name ?? 'No name'}
                    </label>
                  ))}
                </div>
              )}
            </fieldset>
          </>
        )}
      </Section>

      <Section
        title="Prizes"
        hint="Ranked prizes go to the top of the frozen leaderboard. Leave the rank empty for a special award you choose by hand."
      >
        {prizes.map((p, i) => (
          <div key={i} className="grid items-center gap-2 sm:grid-cols-[5rem_1fr_9rem_8rem_auto]">
            <input
              aria-label="Rank"
              type="number"
              min={1}
              placeholder="Special"
              className={inputClass}
              value={p.rank}
              onChange={(e) =>
                setPrizes(prizes.map((x, j) => (j === i ? { ...x, rank: e.target.value } : x)))
              }
            />
            <input
              aria-label="Prize"
              className={inputClass}
              value={p.title}
              onChange={(e) =>
                setPrizes(prizes.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))
              }
            />
            <select
              aria-label="Kind"
              className={inputClass}
              value={p.kind}
              onChange={(e) =>
                setPrizes(prizes.map((x, j) => (j === i ? { ...x, kind: e.target.value } : x)))
              }
            >
              {PRIZE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k.charAt(0) + k.slice(1).toLowerCase()}
                </option>
              ))}
            </select>
            <input
              aria-label="Amount (₹)"
              inputMode="decimal"
              placeholder="₹ (optional)"
              className={inputClass}
              value={p.amount}
              onChange={(e) =>
                setPrizes(prizes.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))
              }
            />
            <Button
              type="button"
              size="sm"
              variant="quiet"
              onClick={() => setPrizes(prizes.filter((_, j) => j !== i))}
            >
              Remove
            </Button>
          </div>
        ))}
        <div>
          <Button
            type="button"
            size="sm"
            onClick={() =>
              setPrizes([
                ...prizes,
                {
                  rank: String(prizes.filter((x) => x.rank).length + 1),
                  title: '',
                  kind: 'CASH',
                  amount: '',
                },
              ])
            }
          >
            Add prize
          </Button>
        </div>
      </Section>

      {paid && (
        <Section
          title="Money split"
          hint="How entry fees are divided. Set per contest. GST is a percentage of the platform fee."
        >
          <div className="grid gap-3 sm:grid-cols-3">
            {FINANCE_FIELDS.map(([k, label]) => (
              <L key={k} label={`${label} (%)`}>
                <input
                  inputMode="decimal"
                  className={inputClass}
                  value={money[k]}
                  onChange={(e) => setMoney({ ...money, [k]: e.target.value })}
                />
              </L>
            ))}
            <L label="Judge fees (₹, fixed)">
              <input
                inputMode="decimal"
                className={inputClass}
                value={money.judgeFeesPaise}
                onChange={(e) => setMoney({ ...money, judgeFeesPaise: e.target.value })}
              />
            </L>
          </div>
          <p className={`text-sm ${pctOfGross > 100 ? 'text-danger' : 'text-muted'}`}>
            Percentages take {pctOfGross.toFixed(2)}% of entry fees
            {pctOfGross > 100 ? ', which is more than 100%' : ''}.
          </p>
          {atMax && (
            <p
              className={`rounded-md px-3 py-2 text-sm ${atMax.left < 0 ? 'bg-danger-wash text-danger' : 'bg-teal-wash text-teal'}`}
            >
              At {f.max} entries: {formatPaise(atMax.gross)} collected, {formatPaise(atMax.prize)}{' '}
              prize pool,{' '}
              {atMax.left < 0
                ? `${formatPaise(-atMax.left)} short`
                : `${formatPaise(atMax.left)} unallocated`}
              .
            </p>
          )}
        </Section>
      )}

      <Section title="Rules and terms">
        <L label="Rules">
          <textarea
            className={`${inputClass} h-auto py-2`}
            rows={4}
            value={f.rules}
            onChange={set('rules')}
          />
        </L>
        <L
          label="Terms"
          hint="Include eligibility, refunds and how winners are paid. Have them reviewed for paid contests."
        >
          <textarea
            className={`${inputClass} h-auto py-2`}
            rows={4}
            value={f.terms}
            onChange={set('terms')}
          />
        </L>
      </Section>

      {error && <ErrorNote>{error}</ErrorNote>}
      <div className="flex gap-2">
        <Button variant="primary" onClick={submit} disabled={pending}>
          {pending ? 'Saving…' : contest ? 'Save changes' : 'Create draft'}
        </Button>
      </div>
    </div>
  );
}
