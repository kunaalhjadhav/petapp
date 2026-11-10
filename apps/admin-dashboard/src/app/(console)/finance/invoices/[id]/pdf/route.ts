import { proxyFile } from '@/lib/proxy';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** An invoice PDF, fetched with the staff member's token (the API checks finance access). */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return new Response('Not found', { status: 404 });
  return proxyFile(`/admin/finance/invoices/${id}/pdf`, `/finance/invoices`);
}
