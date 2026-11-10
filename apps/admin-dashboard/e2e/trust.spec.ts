import { expect, test } from '@playwright/test';
import { Client } from 'pg';

/**
 * AI moderation and account risk screens. Fixtures straight in the database: a comment that AI moderation flagged
 * (with its check and an open case), and a high-risk account. Fresh names each run so it can be repeated.
 */
const DB =
  process.env.E2E_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5432/petapp';
const tag = Date.now().toString(36);
const commentText = `Cheap followers ${tag}, DM me`;
const riskyName = `Risky Voter ${tag}`;
let caseId = '';
let riskyId = '';

test.beforeAll(async () => {
  const db = new Client({ connectionString: DB });
  await db.connect();
  try {
    await db.query('BEGIN');
    const user = async (name: string, phone: string) =>
      (
        await db.query(
          `INSERT INTO "User" (id, name, phone, "phoneVerifiedAt", "createdAt", "updatedAt") VALUES (gen_random_uuid(), $1, $2, now(), now(), now()) RETURNING id`,
          [name, phone],
        )
      ).rows[0].id as string;
    const author = await user(`Poster ${tag}`, `+9195${String(Date.now()).slice(-8)}`);
    const spammer = await user(`Spammer ${tag}`, `+9194${String(Date.now()).slice(-8)}`);
    const post = (
      await db.query(
        `INSERT INTO "Post" (id, "authorId", type, caption, status, "publishedAt", "createdAt", "updatedAt") VALUES (gen_random_uuid(), $1, 'PHOTO', 'Beach day', 'PUBLISHED', now(), now(), now()) RETURNING id`,
        [author],
      )
    ).rows[0].id;
    const comment = (
      await db.query(
        `INSERT INTO "Comment" (id, "postId", "authorId", body, "createdAt", "updatedAt") VALUES (gen_random_uuid(), $1, $2, $3, now(), now()) RETURNING id`,
        [post, spammer, commentText],
      )
    ).rows[0].id;
    const check = (
      await db.query(
        `INSERT INTO "AiAssessment" (id, "targetType", "targetId", "ownerId", "inputHash", verdict, labels, "topLabel", confidence, reason, provider, model, version, "createdAt")
         VALUES (gen_random_uuid(), 'COMMENT', $1, $2, $3, 'FLAGGED', $4, 'SPAM', 0.92, 'Offers to sell followers to strangers.', 'anthropic', 'claude-haiku-5-5', 'moderation-v1', now()) RETURNING id`,
        [
          comment,
          spammer,
          `e2e-${tag}`,
          JSON.stringify([
            { label: 'SPAM', score: 0.92 },
            { label: 'ABUSE', score: 0.1 },
          ]),
        ],
      )
    ).rows[0].id;
    caseId = (
      await db.query(
        `INSERT INTO "ModerationCase" (id, "targetType", "targetId", "openKey", "reportCount", "lastReportedAt", "aiAssessmentId", "aiFlaggedAt", "createdAt", "updatedAt")
         VALUES (gen_random_uuid(), 'COMMENT', $1, $2, 0, now(), $3, now(), now(), now()) RETURNING id`,
        [comment, `COMMENT:${comment}`, check],
      )
    ).rows[0].id;
    riskyId = await user(riskyName, `+9193${String(Date.now()).slice(-8)}`);
    await db.query(
      `INSERT INTO "AccountRisk" ("userId", score, level, signals, "computedAt") VALUES ($1, 80, 'HIGH', $2, now())`,
      [
        riskyId,
        JSON.stringify([
          {
            signal: 'shared_network',
            points: 35,
            detail: '14 other accounts signed in from the same network this week',
          },
          {
            signal: 'held_votes',
            points: 30,
            detail: '11 contest votes held for review this month',
          },
          { signal: 'new_account', points: 15, detail: 'Account is less than a day old' },
        ]),
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

test('an AI-flagged comment shows the check, and a moderator decides', async ({ page }) => {
  await page.goto('/moderation?source=ai');
  const row = page.getByRole('row', { name: new RegExp(commentText) });
  await expect(row).toContainText('AI: Spam 92%');
  await expect(row).toContainText('None'); // no reports from people
  await row.getByRole('link').click();
  await expect(page).toHaveURL(new RegExp(`/moderation/${caseId}$`));
  await expect(page.getByRole('heading', { name: /Flagged comment/ })).toBeVisible();
  const ai = page
    .getByRole('region', { name: 'AI moderation' })
    .or(page.locator('section', { hasText: 'AI moderation' }));
  await expect(ai.first()).toContainText('Flagged for review');
  await expect(ai.first()).toContainText('Offers to sell followers to strangers.');
  await expect(ai.first()).toContainText('model claude-haiku-5-5 · version moderation-v1');
  await expect(page.getByRole('heading', { name: /^Reports/ })).toHaveCount(0);
  await page.getByRole('radio', { name: /Hide/ }).check();
  await page.getByLabel('Note').fill('Follower selling');
  await page.getByRole('button', { name: 'Resolve case' }).click();
  await expect(page.getByText('Hidden', { exact: true }).first()).toBeVisible();
});

test('AI moderation page: status, settings and the list of checks', async ({ page }) => {
  await page.goto('/trust');
  await expect(page.getByRole('heading', { name: 'AI moderation' })).toBeVisible();
  await expect(page.getByText('Checking')).toBeVisible();
  const flagged = page.getByRole('row', { name: /Spam 92%/ }).first();
  await expect(flagged).toContainText('Offers to sell followers');
  await expect(flagged).toContainText('claude-haiku-5-5');
  // Settings: hiding needs at least the flag threshold; then save a valid change and put it back.
  const flag = page.getByLabel('Open a case at (%)');
  const original = await flag.inputValue();
  await page.getByLabel('Hide while waiting at (%)').fill('50');
  await flag.fill('80');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(/Hiding should need at least as much confidence/)).toBeVisible();
  await page.getByLabel('Hide while waiting at (%)').fill('0');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(/Saved\. Recorded in the audit log\./)).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Open a case at (%)')).toHaveValue('80');
  await page.getByLabel('Open a case at (%)').fill(original);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText(/Saved\./)).toBeVisible();
});

test('account risk: listed for review with reasons; a review moves it to Reviewed and never touches the account', async ({
  page,
}) => {
  await page.goto('/trust/risk');
  const row = page.getByRole('row', { name: new RegExp(riskyName) });
  await expect(row).toContainText('80 · high');
  await expect(row).toContainText('Shared network');
  await row.getByRole('link', { name: riskyName }).click();
  await expect(
    page.getByText('14 other accounts signed in from the same network this week'),
  ).toBeVisible();
  await expect(page.getByText('+35')).toBeVisible();
  await page.getByLabel('What you found').fill('Hostel Wi-Fi; checked with the contest team');
  await page.getByRole('button', { name: 'Record review' }).click();
  await expect(page.getByText('“Hostel Wi-Fi; checked with the contest team”')).toBeVisible();
  await expect(page.getByText('Active', { exact: true }).first()).toBeVisible();
  await page.goto('/trust/risk');
  await expect(page.getByRole('row', { name: new RegExp(riskyName) })).toHaveCount(0);
  await page.goto('/trust/risk?state=reviewed');
  await expect(page.getByRole('row', { name: new RegExp(riskyName) })).toContainText(
    'Reviewed: Hostel Wi-Fi',
  );
});
