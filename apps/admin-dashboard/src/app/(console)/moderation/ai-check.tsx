import { formatDateTime } from '@/lib/format';
import { AI_LABELS, confidence } from '@/lib/labels';
import type { AiCheck } from '@/lib/types';
import { Tag } from '@/components/ui';

const VERDICT: Record<AiCheck['verdict'], { label: string; tone: 'warn' | 'good' | 'danger' }> = {
  FLAGGED: { label: 'Flagged for review', tone: 'warn' },
  CLEAR: { label: 'Nothing found', tone: 'good' },
  ERROR: { label: 'Check failed', tone: 'danger' },
};

/** One AI check, as a moderator needs it: what it thinks, how sure it is, why, and which model said so. */
export function AiCheckView({ check }: { check: AiCheck }) {
  const v = VERDICT[check.verdict];
  return (
    <div className="flex flex-col gap-3">
      <p className="flex flex-wrap items-center gap-2 text-sm">
        <Tag tone={v.tone}>{v.label}</Tag>
        <span className="text-muted">{formatDateTime(check.createdAt)}</span>
      </p>
      {check.labels.length > 0 && (
        <ul className="flex flex-col gap-1.5" aria-label="What the check found">
          {check.labels.map((l) => (
            <li
              key={l.label}
              className="grid grid-cols-[10rem_1fr_3rem] items-center gap-3 text-sm"
            >
              <span>{AI_LABELS[l.label] ?? l.label}</span>
              <span className="h-1.5 overflow-hidden rounded-full bg-line-soft" aria-hidden>
                <span
                  className={`block h-full rounded-full ${l.score >= 0.7 ? 'bg-warn' : 'bg-muted'}`}
                  style={{ width: `${Math.round(l.score * 100)}%` }}
                />
              </span>
              <span className="text-right tabular-nums text-muted">{confidence(l.score)}</span>
            </li>
          ))}
        </ul>
      )}
      {check.reason && <p className="max-w-[65ch] text-sm">{check.reason}</p>}
      {check.error && <p className="text-xs text-danger">{check.error}</p>}
      <p className="text-xs text-faint">
        {check.provider === 'rules' ? 'PetApp rules' : check.provider} · model {check.model} ·
        version {check.version}
      </p>
    </div>
  );
}
