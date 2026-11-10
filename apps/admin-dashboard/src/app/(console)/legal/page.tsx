import Link from 'next/link';
import type { Metadata } from 'next';
import { PERMISSIONS } from '@petapp/types';
import { api } from '@/lib/api';
import { can, getMe } from '@/lib/me';
import { formatDate, formatNumber } from '@/lib/format';
import { LEGAL_AUDIENCES } from '@/lib/labels';
import type { LegalRow } from '@/lib/types';
import { NoAccess, PageHeader, Panel, Tag } from '@/components/ui';
import { Table, Td } from '@/components/table';

export const metadata: Metadata = { title: 'Legal documents' };
export const dynamic = 'force-dynamic';

export default async function LegalPage() {
  const me = await getMe();
  if (!can(me, PERMISSIONS.SETTINGS_READ)) return <NoAccess what="legal documents" />;
  const rows = await api<LegalRow[]>('/admin/legal');
  const unpublished = rows.filter((r) => !r.current).length;

  return (
    <>
      <PageHeader
        title="Legal documents"
        description="The policies and terms shown in the apps and on the website. Each change is a new version; publishing one replaces the current version, and people are asked to accept it again when acceptance is required."
      />

      {unpublished > 0 && (
        <div
          role="note"
          className="mb-6 rounded-lg border border-line bg-warn-wash px-4 py-3 text-sm"
        >
          <p className="font-medium">
            {unpublished} of {rows.length} documents aren’t published yet.
          </p>
          <p className="mt-1 text-muted">
            The first versions are templates written for an Indian consumer app (DPDP Act 2023, IT
            Rules 2021, Consumer Protection (E-Commerce) Rules 2020). They are not legal advice:
            have a lawyer review them, fill in every {'{{placeholder}}'} (company name, grievance
            officer, time limits…), then publish. Publishing is refused while placeholders remain.
          </p>
        </div>
      )}

      <Panel>
        <Table head={['Document', 'Who accepts it', 'People see', 'Accepted by', 'Draft']}>
          {rows.map((r) => (
            <tr key={r.slug}>
              <Td>
                <Link
                  href={`/legal/${(r.current ?? r.draft)!.id}`}
                  className="font-medium text-teal hover:underline"
                >
                  {r.title}
                </Link>
                <span className="block text-xs text-muted">/{r.slug}</span>
              </Td>
              <Td className="text-sm text-muted">
                {(r.current ?? r.draft)?.requiresAcceptance
                  ? LEGAL_AUDIENCES[r.audience]
                  : 'Nobody (for reading)'}
              </Td>
              <Td>
                {r.current ? (
                  <span className="text-sm">
                    Version {r.current.version}
                    <span className="block text-xs text-muted">
                      since {formatDate(r.current.effectiveAt)}
                    </span>
                  </span>
                ) : (
                  <Tag tone="warn">Not published</Tag>
                )}
              </Td>
              <Td className="tabular-nums">
                {r.current?.requiresAcceptance ? formatNumber(r.current.acceptances) : '—'}
              </Td>
              <Td>
                {r.draft ? (
                  <Link href={`/legal/${r.draft.id}`} className="text-sm text-teal hover:underline">
                    Version {r.draft.version}
                    {r.draft.placeholders > 0 && (
                      <span className="block text-xs text-warn">
                        {r.draft.placeholders} placeholder{r.draft.placeholders === 1 ? '' : 's'} to
                        fill in
                      </span>
                    )}
                  </Link>
                ) : (
                  <span className="text-sm text-faint">—</span>
                )}
              </Td>
            </tr>
          ))}
        </Table>
      </Panel>
    </>
  );
}
