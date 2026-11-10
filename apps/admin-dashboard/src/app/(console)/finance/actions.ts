'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, act, api, type ActionState } from '@/lib/api';
import { isMonth, type BatchDetail, type CommissionRun, type ReconRun } from '@/lib/finance';

const bad = (message: string): ActionState => ({ ok: false, message, at: Date.now() });
const text = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();

// ── refunds ──

export async function retryRefund(id: string): Promise<ActionState> {
  const r = await act(
    () => api(`/admin/finance/refunds/${id}/retry`, { method: 'POST' }),
    'Back in the queue. It will be sent within a minute.',
  );
  revalidatePath('/finance/refunds');
  return r;
}

export async function settleRefundManually(
  id: string,
  _: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const reference = text(fd, 'reference');
  if (reference.length < 4)
    return bad('Enter how the customer was paid, e.g. the bank transfer’s UTR number.');
  const r = await act(
    () =>
      api(`/admin/finance/refunds/${id}/settle-manually`, { method: 'POST', body: { reference } }),
    'Recorded as paid',
  );
  revalidatePath('/finance/refunds');
  revalidatePath('/finance');
  return r;
}

// ── reconciliation ──

export async function runReconciliation(): Promise<ActionState> {
  let run: ReconRun;
  try {
    run = await api<ReconRun>('/admin/finance/reconciliation/run', { method: 'POST' });
  } catch (e) {
    if (e instanceof ApiError) return bad(e.message);
    throw e;
  }
  revalidatePath('/finance/reconciliation');
  revalidatePath('/finance');
  const n = run.summary?.newIssues ?? 0;
  const fixed = run.summary?.repaired ?? 0;
  const parts = [
    run.status === 'OK'
      ? 'Everything matched'
      : run.status === 'FAILED'
        ? 'The run didn’t finish'
        : 'Done',
    fixed ? `${fixed} missing posting${fixed === 1 ? '' : 's'} repaired` : '',
    n ? `${n} new issue${n === 1 ? '' : 's'}` : '',
  ].filter(Boolean);
  return { ok: run.status !== 'FAILED', message: parts.join('. '), at: Date.now() };
}

export async function resolveIssue(id: string, _: ActionState, fd: FormData): Promise<ActionState> {
  const resolution = text(fd, 'resolution');
  if (resolution.length < 3) return bad('Say what was done about it.');
  const r = await act(
    () =>
      api(`/admin/finance/reconciliation/issues/${id}/resolve`, {
        method: 'POST',
        body: { resolution },
      }),
    'Marked resolved',
  );
  revalidatePath('/finance/reconciliation');
  revalidatePath('/finance');
  return r;
}

export async function recoverPayment(paymentId: string): Promise<ActionState> {
  const r = await act(
    () => api(`/admin/finance/payments/${paymentId}/recover`, { method: 'POST' }),
    'Payment confirmed with the gateway and completed',
  );
  revalidatePath('/finance/reconciliation');
  revalidatePath('/finance');
  return r;
}

// ── payouts ──

export async function prepareBatch(_: ActionState, fd: FormData): Promise<ActionState> {
  const payeeType = text(fd, 'payeeType') || undefined;
  if (payeeType && !['VENDOR', 'PARTNER', 'USER'].includes(payeeType))
    return bad('Pick who to pay.');
  const note = text(fd, 'note') || undefined;
  let batch: BatchDetail;
  try {
    batch = await api<BatchDetail>('/admin/finance/payout-batches', {
      method: 'POST',
      body: { payeeType, note },
    });
  } catch (e) {
    if (e instanceof ApiError) return bad(e.message);
    throw e;
  }
  revalidatePath('/finance/payouts');
  redirect(`/finance/payouts/${batch.id}`);
}

export async function approveBatch(id: string): Promise<ActionState> {
  let b: BatchDetail;
  try {
    b = await api<BatchDetail>(`/admin/finance/payout-batches/${id}/approve`, { method: 'POST' });
  } catch (e) {
    if (e instanceof ApiError) return bad(e.message);
    throw e;
  }
  revalidatePath(`/finance/payouts/${id}`);
  revalidatePath('/finance/payouts');
  const dropped = b.payouts.filter((p) => p.status === 'CANCELLED').length;
  return {
    ok: true,
    message:
      b.status === 'CANCELLED'
        ? 'Nothing was sent: every payee’s balance or account changed since the batch was prepared.'
        : dropped
          ? `Approved. ${dropped} payee${dropped === 1 ? ' was' : 's were'} dropped because their balance or account changed.`
          : 'Approved. Payouts are being sent.',
    at: Date.now(),
  };
}

export async function cancelBatch(id: string): Promise<ActionState> {
  const r = await act(
    () => api(`/admin/finance/payout-batches/${id}/cancel`, { method: 'POST' }),
    'Batch cancelled',
  );
  revalidatePath(`/finance/payouts/${id}`);
  revalidatePath('/finance/payouts');
  return r;
}

export async function disablePayoutAccount(
  id: string,
  _: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const reason = text(fd, 'reason');
  if (reason.length < 3) return bad('Give a reason. It is kept in the audit log.');
  const r = await act(
    () => api(`/admin/finance/payout-accounts/${id}/disable`, { method: 'POST', body: { reason } }),
    'Account switched off',
  );
  revalidatePath('/finance/payout-accounts');
  return r;
}

// ── prizes, settlements, invoices ──

export async function approvePrize(id: string): Promise<ActionState> {
  const r = await act(
    () => api(`/admin/finance/prizes/${id}/approve`, { method: 'POST' }),
    'Approved. It will be paid in the next payout batch.',
  );
  revalidatePath('/finance/prizes');
  return r;
}

export async function syncSettlements(): Promise<ActionState> {
  let added: number;
  try {
    added = (await api<{ added: number }>('/admin/finance/settlements/sync', { method: 'POST' }))
      .added;
  } catch (e) {
    if (e instanceof ApiError) return bad(e.message);
    throw e;
  }
  revalidatePath('/finance/settlements');
  return {
    ok: true,
    message: added
      ? `${added} new settlement${added === 1 ? '' : 's'} booked`
      : 'Up to date: no new settlements',
    at: Date.now(),
  };
}

export async function issueCommissionInvoices(_: ActionState, fd: FormData): Promise<ActionState> {
  const month = text(fd, 'month');
  if (!isMonth(month)) return bad('Pick a month.');
  let r: CommissionRun;
  try {
    r = await api<CommissionRun>('/admin/finance/invoices/commission', {
      method: 'POST',
      body: { month },
    });
  } catch (e) {
    if (e instanceof ApiError) return bad(e.message);
    throw e;
  }
  revalidatePath('/finance/invoices');
  const n = r.issued.length;
  return {
    ok: true,
    message: n
      ? `${n} commission invoice${n === 1 ? '' : 's'} issued`
      : 'No new invoices: everyone with fees that month already has one.',
    at: Date.now(),
  };
}
