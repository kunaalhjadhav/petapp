import type { Metadata } from 'next';
import { PERMISSIONS } from '@petapp/types';
import { api } from '@/lib/api';
import { can, getMe } from '@/lib/me';
import { formatDateTime } from '@/lib/format';
import type { SettlementRow } from '@/lib/finance';
import { Empty, NoAccess, PageHeader, Panel } from '@/components/ui';
import { InlineForm, SubmitButton } from '@/components/forms';
import { Amount, Stat, Stats } from '@/components/finance';
import { Table, Td } from '@/components/table';
import { syncSettlements } from '../actions';

export const metadata: Metadata = { title: 'Settlements' };

export default async function SettlementsPage() {
  const me = await getMe();
  if (!can(me, PERMISSIONS.FINANCE_READ)) return <NoAccess what="settlements" />;
  const manage = can(me, PERMISSIONS.FINANCE_MANAGE);
  const rows = await api<SettlementRow[]>('/admin/finance/settlements');
  const sum = (k: 'amountPaise' | 'feesPaise' | 'taxPaise') => rows.reduce((a, r) => a + r[k], 0);

  return (
    <>
      <PageHeader
        title="Gateway settlements"
        description="Transfers from the payment gateway to PetApp’s bank account. Each is booked automatically: the money reaches the bank, the gateway’s fees are an expense, and the GST on those fees is input credit. Fetched every night at 2 am."
        actions={
          manage && (
            <InlineForm action={syncSettlements} className="flex items-center gap-3">
              <SubmitButton variant="secondary">Fetch now</SubmitButton>
            </InlineForm>
          )
        }
      />
      {rows.length > 0 && (
        <div className="mb-6">
          <Stats>
            <Stat label={`Reached the bank (latest ${rows.length})`} paise={sum('amountPaise')} />
            <Stat label="Gateway fees" paise={sum('feesPaise')} hint="GST included" />
            <Stat label="GST input credit" paise={sum('taxPaise')} />
          </Stats>
        </div>
      )}
      <Panel>
        {rows.length === 0 ? (
          <Empty title="No settlements yet">
            They appear once the gateway transfers money to the bank, usually two working days after
            a payment.
          </Empty>
        ) : (
          <Table
            head={[
              'Settled',
              'Settlement',
              'Bank reference (UTR)',
              'To the bank',
              'Fees',
              'GST in fees',
            ]}
            numeric={[3, 4, 5]}
          >
            {rows.map((s) => (
              <tr key={s.id}>
                <Td className="whitespace-nowrap">{formatDateTime(s.settledAt)}</Td>
                <Td className="font-mono text-xs">{s.providerSettlementId}</Td>
                <Td className="font-mono text-xs">{s.utr ?? '—'}</Td>
                <Td className="text-right">
                  <Amount paise={s.amountPaise} />
                </Td>
                <Td className="text-right">
                  <Amount paise={s.feesPaise} />
                </Td>
                <Td className="text-right">
                  <Amount paise={s.taxPaise} />
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Panel>
    </>
  );
}
