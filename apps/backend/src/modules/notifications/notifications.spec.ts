import { extractMentions } from './mentions';
import { renderNotification } from './render';
import { FcmPushProvider } from '../../providers/push/push.provider';

describe('extractMentions', () => {
  it('finds pet handles and ignores emails', () => {
    expect(extractMentions('Play date with @bruno.3fa9c1 and (@mishti.demo)! mail me at aanya@example.com')).toEqual(['bruno.3fa9c1', 'mishti.demo']);
  });
  it('ignores a trailing dot and caps at 10', () => {
    expect(extractMentions('Hi @kiwi.demo.')).toEqual(['kiwi.demo']);
    expect(extractMentions(Array.from({ length: 15 }, (_, i) => `@pet${i}x`).join(' '))).toHaveLength(10);
  });
});

describe('renderNotification', () => {
  it('groups actors', () => {
    expect(renderNotification({ type: 'POST_LIKE', actorName: 'Riya', count: 5, data: {} }).body).toBe('Riya and 4 others liked your post.');
    expect(renderNotification({ type: 'NEW_FOLLOWER', actorName: 'Kabir', count: 2, data: {} }).body).toBe('Kabir and 1 other started following you.');
  });
  it('quotes and trims snippets', () => {
    const b = renderNotification({ type: 'POST_COMMENT', actorName: 'Riya', count: 1, data: { body: `So   cute ${'x'.repeat(200)}` } }).body;
    expect(b.startsWith('Riya commented: “So cute x')).toBe(true);
    expect(b.length).toBeLessThan(120);
  });
  it('covers every type', () => {
    for (const type of ['POST_LIKE', 'POST_COMMENT', 'COMMENT_REPLY', 'MENTION', 'NEW_FOLLOWER', 'PET_FOLLOWER', 'POST_PUBLISHED', 'POST_FAILED', 'CONTENT_REMOVED', 'ACCOUNT_STATUS', 'CONTEST_ENTRY_CONFIRMED', 'CONTEST_VOTING_OPEN', 'CONTEST_RESULT', 'CHALLENGE_COMPLETED', 'BADGE_EARNED', 'PARTNER_STATUS', 'BOOKING_CONFIRMED', 'BOOKING_CANCELLED', 'BOOKING_COMPLETED', 'VENDOR_STATUS', 'VENDOR_NEW_ORDER', 'ORDER_CONFIRMED', 'ORDER_UPDATE', 'REVIEW_RECEIVED', 'REVIEW_REPLY'] as const) {
      const r = renderNotification({ type, actorName: 'A', count: 1, data: {} });
      expect(r.title.length).toBeGreaterThan(0);
      expect(r.body.length).toBeGreaterThan(0);
    }
  });
});

describe('FcmPushProvider', () => {
  const key = '-----BEGIN PRIVATE KEY-----\\nMIIBVQIBADANBgkqhkiG9w0BAQEFAASCAT8wggE7AgEAAkEA\\n-----END PRIVATE KEY-----';  // gitleaks:allow (a truncated, fake key)
  const make = (status: number, body: string) => {
    const p = new FcmPushProvider('proj', 'svc@proj.iam.gserviceaccount.com', key, (async () => new Response(body, { status })) as typeof fetch);
    // Skip the real OAuth exchange in unit tests.
    (p as unknown as { auth: { getAccessToken: () => Promise<{ token: string }> } }).auth.getAccessToken = async () => ({ token: 't' });
    return p;
  };
  const msg = { token: 'tok', title: 't', body: 'b', data: {} };
  it('reports success, invalid tokens, and retries server errors', async () => {
    await expect(make(200, '{}').send(msg)).resolves.toBe('sent');
    await expect(make(404, '{"error":{"status":"NOT_FOUND","details":[{"errorCode":"UNREGISTERED"}]}}').send(msg)).resolves.toBe('invalid-token');
    await expect(make(400, '{"error":{"status":"INVALID_ARGUMENT","message":"The registration token is not a valid FCM registration token"}}').send(msg)).resolves.toBe('invalid-token');
    await expect(make(503, 'unavailable').send(msg)).rejects.toThrow(/temporarily/);
    await expect(make(403, 'denied').send(msg)).resolves.toBe('failed');
  });
  it('renders Phase 9d reminders, votes, memberships and promotions', () => {
    expect(renderNotification({ type: 'BOOKING_REMINDER', count: 1, data: { serviceName: 'Full groom', petName: 'Bruno', partnerName: 'Pawfect', when: 'Tue, 21 Oct, 10:00 am', atHome: true, code: 'BK-1' } }))
      .toEqual({ title: 'Coming up: Full groom', body: 'Bruno’s visit with Pawfect is Tue, 21 Oct, 10:00 am. They’ll come to you. Booking BK-1.' });
    expect(renderNotification({ type: 'CONTEST_REMINDER', count: 1, data: { stage: 'SUBMIT', contestTitle: 'Summer Smiles', petName: 'Luna', when: 'tomorrow at 6:00 pm' } }).body)
      .toBe('Entries for Summer Smiles close tomorrow at 6:00 pm. Add Luna’s entry so it can be judged.');
    expect(renderNotification({ type: 'CONTEST_REMINDER', count: 1, data: { stage: 'VOTING', contestTitle: 'Summer Smiles', petName: 'Luna' } }).title).toBe('Voting closes soon');
    expect(renderNotification({ type: 'CONTEST_VOTES', count: 1, data: { votes: 1, petName: 'Luna', contestTitle: 'Summer Smiles' } })).toEqual({ title: '1 new vote', body: 'Luna got 1 new vote in Summer Smiles.' });
    expect(renderNotification({ type: 'MEMBERSHIP_UPDATE', count: 1, data: { event: 'ACTIVE', plan: 'Plus', until: '19 Nov 2026' } }).body).toBe('Your Plus membership is active until 19 Nov 2026.');
    expect(renderNotification({ type: 'MEMBERSHIP_UPDATE', count: 1, data: { event: 'EXPIRED', plan: 'Plus' } }).title).toBe('Your membership has ended');
    expect(renderNotification({ type: 'MEMBERSHIP_UPDATE', count: 1, data: { event: 'RENEWED', plan: 'Plus', until: '19 Dec 2026' } }).body).toBe('Your Plus membership now runs until 19 Dec 2026.');
    expect(renderNotification({ type: 'PROMOTION', count: 1, data: { title: 'Diwali offers', body: '20% off treats this week.' } })).toEqual({ title: 'Diwali offers', body: '20% off treats this week.' });
  });
});
