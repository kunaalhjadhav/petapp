import { expect, test } from '@playwright/test';
import bcrypt from 'bcryptjs';
import { Client } from 'pg';
import { openDialog } from './helpers';

/**
 * Finance screens, with fixtures straight in the database:
 * - a second staff member with the FINANCE role (payout batches need a different approver);
 * - an approved seller with ₹500 of earnings past the holding period, and a verified UPI account.
 * The earnings are posted as a balanced ledger transaction (seller credited, PetApp's discount
 * expense debited), so the books still balance and reconciliation's control checks still hold.
 * Each run uses fresh names so it can be repeated.
 */
const DB =
  process.env.E2E_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5432/petapp';
const tag = Date.now().toString(36);
const store = `Pawsome Supplies ${tag}`;
const financeEmail = `finance-${tag}@petapp.local`;
const financePassword = `Finance-${tag}-Pass!`;
const invoiceNumber = `E2EI/2627/${tag.slice(-5).toUpperCase()}`;
let vendorId = '';

test.beforeAll(async () => {
  const db = new Client({ connectionString: DB });
  await db.connect();
  try {
    await db.query('BEGIN');
    // Second finance person
    const fin = await db.query(
      `INSERT INTO "User" (id, name, email, "passwordHash", "emailVerifiedAt", "createdAt", "updatedAt")
       VALUES (gen_random_uuid(), $1, $2, $3, now(), now(), now()) RETURNING id`,
      [`Farah Finance ${tag}`, financeEmail, await bcrypt.hash(financePassword, 10)],
    );
    await db.query(
      `INSERT INTO "UserRole" ("userId", "roleId", "createdAt") SELECT $1, id, now() FROM "Role" WHERE key = 'FINANCE'`,
      [fin.rows[0].id],
    );
    // Seller with payable earnings and a verified UPI account
    const owner = await db.query(
      `INSERT INTO "User" (id, name, phone, "phoneVerifiedAt", "createdAt", "updatedAt") VALUES (gen_random_uuid(), $1, $2, now(), now(), now()) RETURNING id`,
      [`Owner ${tag}`, `+9196${String(Date.now()).slice(-8)}`],
    );
    const v = await db.query(
      `INSERT INTO "Vendor" (id, "userId", "businessName", slug, phone, "addressLine", city, state, pincode, status, "createdAt", "updatedAt")
       VALUES (gen_random_uuid(), $1, $2, $3, '+919800000001', '2 Market Road', 'Pune', 'Maharashtra', '411001', 'APPROVED', now(), now()) RETURNING id`,
      [owner.rows[0].id, store, `pawsome-${tag}`],
    );
    vendorId = v.rows[0].id;
    const acct = await db.query(
      `INSERT INTO "LedgerAccount" (id, code, name, type, "ownerType", "ownerId", "createdAt")
       VALUES (gen_random_uuid(), $1, $2, 'LIABILITY', 'VENDOR', $3, now()) RETURNING id`,
      [`VENDOR:${vendorId}`, `Owed to ${store}`, vendorId],
    );
    await db.query(
      `INSERT INTO "LedgerAccount" (id, code, name, type, "createdAt") VALUES (gen_random_uuid(), 'PLATFORM_DISCOUNTS', 'Discounts PetApp pays for', 'EXPENSE', now())
       ON CONFLICT (code) DO NOTHING`,
    );
    const tx = await db.query(
      `INSERT INTO "LedgerTransaction" (id, kind, reference, memo, "occurredAt", "createdAt")
       VALUES (gen_random_uuid(), 'E2E_FIXTURE', $1, 'Test earnings for the finance screens', now() - interval '10 days', now()) RETURNING id`,
      [`e2e:finance:${tag}`],
    );
    await db.query(
      `INSERT INTO "LedgerEntry" (id, "transactionId", "accountId", "debitPaise", "creditPaise", "createdAt")
       VALUES (gen_random_uuid(), $1, (SELECT id FROM "LedgerAccount" WHERE code = 'PLATFORM_DISCOUNTS'), 50000, 0, now()),
              (gen_random_uuid(), $1, $2, 0, 50000, now())`,
      [tx.rows[0].id, acct.rows[0].id],
    );
    await db.query(
      `INSERT INTO "PayoutAccount" (id, "ownerType", "ownerId", method, "holderName", vpa, status, "verifiedName", "providerContactId", "providerFundAccountId", "verifiedAt", "payableFrom", "createdAt", "updatedAt")
       VALUES (gen_random_uuid(), 'VENDOR', $1, 'UPI', $2, $3, 'VERIFIED', $2, $4, $5, now() - interval '2 days', now() - interval '1 day', now(), now())`,
      [vendorId, store, `pawsome${tag}@okaxis`, `fake_cont_${tag}`, `fake_fa_${tag}`],
    );
    // A customer invoice, to download as a PDF through the dashboard
    await db.query(
      `INSERT INTO "Invoice" (id, kind, title, series, seq, number, "financialYear", "sourceKey", issuer, recipient, "placeOfSupply", lines,
                              "taxablePaise", "cgstPaise", "sgstPaise", "igstPaise", "totalPaise", "payeeKey", "issuedAt", "createdAt")
       VALUES (gen_random_uuid(), 'CUSTOMER', 'TAX_INVOICE', $1, 1, $2, '2026-27', $3, $4, $5, 'Maharashtra', $6, 10000, 900, 900, 0, 11800, $7, now(), now())`,
      [
        `E2E:${tag}`,
        invoiceNumber,
        `E2E:${tag}`,
        JSON.stringify({
          name: store,
          gstin: '27ABCDE1234F1Z5',
          state: 'Maharashtra',
          address: '2 Market Road, Pune 411001',
        }),
        JSON.stringify({
          name: 'Test Customer',
          state: 'Maharashtra',
          address: '1 Lake Road, Pune 411001',
        }),
        JSON.stringify([
          {
            description: 'Chew toy',
            hsnSac: '9503',
            qty: 1,
            unitPaise: 10000,
            taxablePaise: 10000,
            rateBps: 1800,
            cgstPaise: 900,
            sgstPaise: 900,
            igstPaise: 0,
            totalPaise: 11800,
          },
        ]),
        `VENDOR:${vendorId}`,
      ],
    );
    await db.query('COMMIT');
  } catch (e) {
    await db.query('ROLLBACK');
    throw e;
  } finally {
    await db.end();
  }
});

test('prepare a payout batch, approve it as someone else, and follow the money', async ({
  page,
  browser,
}) => {
  test.setTimeout(150_000);

  // Overview
  await page.goto('/finance');
  await expect(page.getByRole('heading', { name: 'Money overview' })).toBeVisible();
  await expect(page.getByText('Customer money held')).toBeVisible();

  // The seller is due ₹500
  await page.goto('/finance/payouts?type=VENDOR');
  const due = page.getByRole('row', { name: new RegExp(store) });
  await expect(due).toContainText('₹500');

  // Prepare (maker)
  await page.getByRole('button', { name: 'Prepare a batch' }).click();
  const prep = openDialog(page);
  await prep.getByLabel('Who to pay').selectOption('VENDOR');
  await prep.getByLabel('Note (optional)').fill(`E2E ${tag}`);
  await prep.getByRole('button', { name: 'Prepare batch' }).click();
  await expect(page).toHaveURL(/\/finance\/payouts\/[0-9a-f-]{36}$/);
  const batchUrl = page.url();
  await expect(page.getByText('Waiting for approval').first()).toBeVisible();
  await expect(page.getByRole('row', { name: new RegExp(store) })).toContainText('₹500');
  await expect(page.getByRole('row', { name: new RegExp(store) })).toContainText(
    `pawsome${tag}@okaxis`,
  );
  // The person who prepared it can't approve it
  await expect(page.getByText('someone else must approve it')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve and pay' })).toHaveCount(0);

  // Approve (checker), in a separate session
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const fin = await ctx.newPage();
  await fin.goto(`/login?next=${encodeURIComponent(new URL(batchUrl).pathname)}`);
  await fin.getByLabel('Work email').fill(financeEmail);
  await fin.getByLabel('Password').fill(financePassword);
  await fin.getByRole('button', { name: 'Sign in' }).click();
  await expect(fin).toHaveURL(batchUrl);
  // Finance staff see the finance menu
  await expect(fin.getByRole('link', { name: 'Payouts', exact: true })).toBeVisible();
  await fin.getByRole('button', { name: 'Approve and pay' }).click();
  await openDialog(fin).getByRole('button', { name: 'Approve and pay' }).click();
  // The approve button goes once the batch is approved; the record names the approver.
  await expect(fin.getByText(/ by you$/)).toBeVisible();
  await expect(fin.getByRole('button', { name: 'Approve and pay' })).toHaveCount(0);

  // The worker sends it; the fake provider pays at once. Status follows on reload.
  await expect
    .poll(
      async () => {
        await fin.reload();
        return fin.getByRole('row', { name: new RegExp(store) }).innerText();
      },
      { timeout: 90_000, intervals: [2_000, 5_000] },
    )
    .toMatch(/Paid/);
  await expect(fin.getByRole('row', { name: new RegExp(store) })).toContainText('FAKEUTR');
  await ctx.close();

  // The ledger shows the payout on the seller's account, and still balances
  await page.goto('/finance/ledger');
  await expect(page.getByText('Balanced', { exact: true })).toBeVisible();
  await page.goto(`/finance/ledger/${encodeURIComponent(`VENDOR:${vendorId}`)}`);
  await expect(page.getByRole('heading', { name: `Owed to ${store}` })).toBeVisible();
  await page.getByRole('link', { name: 'Payout approved' }).click();
  await expect(
    page.getByRole('row', { name: /Payouts in transit|PAYOUTS_IN_TRANSIT/ }),
  ).toContainText('₹500');
  await expect(page.getByRole('row', { name: /Total/ })).toContainText('₹500');

  // Switch the account off (e.g. reported as not the seller's)
  await page.goto('/finance/payout-accounts?owner=VENDOR');
  const acct = page.getByRole('row', { name: new RegExp(store) });
  await acct.getByRole('button', { name: 'Switch off' }).click();
  await openDialog(page)
    .getByLabel('Reason (kept in the audit log)')
    .fill('E2E: reported by the seller');
  await openDialog(page).getByRole('button', { name: 'Switch off' }).click();
  await page.goto('/finance/payout-accounts?status=DISABLED&owner=VENDOR');
  await expect(page.getByRole('row', { name: new RegExp(store) })).toContainText('Switched off');
});

test('reconciliation, refunds, invoices, settlements, prizes and the tax report', async ({
  page,
}) => {
  test.setTimeout(90_000);

  // Reconciliation on demand
  await page.goto('/finance/reconciliation');
  await page.getByRole('button', { name: 'Run now' }).click();
  await expect(page.getByRole('status').filter({ hasText: /matched|Done|issue/ })).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByRole('table').getByText('Run by staff').first()).toBeVisible();

  // Refund tabs
  await page.goto('/finance/refunds?status=ALL');
  await expect(page.getByRole('heading', { name: 'Refunds' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Failed' })).toBeVisible();

  // Prizes and settlements render
  await page.goto('/finance/prizes');
  await expect(page.getByRole('heading', { name: 'Cash prizes' })).toBeVisible();
  await page.goto('/finance/settlements');
  await page.getByRole('button', { name: 'Fetch now' }).click();
  await expect(page.getByRole('status').filter({ hasText: /settlement/ })).toBeVisible();

  // Commission invoices: issued, already issued, or a clear reason (company details not set)
  await page.goto('/finance/invoices');
  await page.getByRole('button', { name: 'Issue commission invoices' }).click();
  const d = openDialog(page);
  await expect(d.getByLabel('Month')).not.toHaveValue('');
  await d.getByRole('button', { name: 'Issue invoices' }).click();
  await expect(
    page
      .getByRole('status')
      .filter({ hasText: /invoice/ })
      .or(d.getByText(/company name, GSTIN and address/)),
  ).toBeVisible();

  // An invoice PDF comes through the dashboard (the browser never holds the API token)
  await page.goto('/finance/invoices?kind=CUSTOMER');
  const inv = page.getByRole('row', { name: new RegExp(invoiceNumber) });
  await expect(inv).toContainText(store);
  await expect(inv).toContainText('₹118');
  const href = await inv
    .getByRole('link', { name: `PDF of ${invoiceNumber}` })
    .getAttribute('href');
  const pdf = await page.request.get(href!);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()['content-type']).toContain('application/pdf');
  expect((await pdf.body()).subarray(0, 4).toString()).toBe('%PDF');
  expect((await page.request.get('/finance/invoices/not-a-uuid/pdf')).status()).toBe(404);

  // Tax report and its spreadsheet
  await page.goto('/finance/tax');
  await expect(page.getByRole('heading', { name: 'Tax report' })).toBeVisible();
  const month = await page.getByLabel('Month', { exact: true }).inputValue();
  const csv = await page.request.get(`/finance/tax/csv?month=${month}`);
  expect(csv.status()).toBe(200);
  expect(csv.headers()['content-disposition']).toContain(`petapp-tax-${month}.csv`);
  expect(await csv.text()).toContain('"Payee type","Payee","GSTIN","PAN"');
  const tb = await page.request.get('/finance/ledger/csv');
  expect(tb.status()).toBe(200);
  expect(await tb.text()).toContain('"Total"');
});
