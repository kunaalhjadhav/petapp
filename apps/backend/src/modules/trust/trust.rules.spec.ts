import { AI_LABELS, accountRisk, dHash, decide, hamming, isGenericHash, needsReview, normaliseLabels, normaliseText, type RiskSignals } from './trust.rules';
import { isPublicIp } from './risk.service';

describe('trust rules', () => {
  describe('AI labels', () => {
    it('keep known labels only, clamp scores, merge duplicates and sort highest first', () => {
      expect(
        normaliseLabels([
          { label: 'spam', score: 0.4 },
          { label: 'SPAM', score: 0.8 },
          { label: 'MALWARE', score: 0.99 },
          { label: 'ABUSE', score: 1.7 },
          { label: 'UNSAFE', score: Number.NaN },
          { label: 'DUPLICATE', score: -2 },
        ]),
      ).toEqual([
        { label: 'ABUSE', score: 1 },
        { label: 'SPAM', score: 0.8 },
        { label: 'DUPLICATE', score: 0 },
        { label: 'UNSAFE', score: 0 },
      ]);
      expect(AI_LABELS).toContain('SUSPICIOUS_ENTRY');
    });

    it('flag only at or above the threshold; a 0 threshold never flags', () => {
      const labels = normaliseLabels([{ label: 'SPAM', score: 0.7 }, { label: 'ABUSE', score: 0.2 }]);
      expect(decide(labels, 70)).toEqual({ flagged: true, topLabel: 'SPAM', confidence: 0.7 });
      expect(decide(labels, 71).flagged).toBe(false);
      expect(decide(labels, 0).flagged).toBe(false);
      expect(decide([], 50)).toEqual({ flagged: false, topLabel: null, confidence: 0 });
    });
  });

  describe('photo fingerprints', () => {
    const gradient = Array.from({ length: 72 }, (_, i) => (i % 9) * 20); // brighter to the right: every bit 0
    it('dHash compares each pixel with its right neighbour', () => {
      expect(dHash(gradient)).toBe('0000000000000000');
      expect(dHash(gradient.map((v) => 255 - v))).toBe('ffffffffffffffff');
      expect(() => dHash([1, 2, 3])).toThrow(/72/);
    });
    it('hamming distance counts differing bits; flat images are too generic to call copies', () => {
      expect(hamming('0000000000000000', '000000000000000f')).toBe(4);
      expect(hamming('ffffffffffffffff', '0000000000000000')).toBe(64);
      expect(hamming('a5a5a5a5a5a5a5a5', 'a5a5a5a5a5a5a5a5')).toBe(0);
      expect(isGenericHash('0000000000000000')).toBe(true);
      expect(isGenericHash('ffffffffffffffff')).toBe(true);
      expect(isGenericHash('a5a5a5a5a5a5a5a5')).toBe(false);
    });
  });

  it('normalises text for duplicate checks', () => {
    expect(normaliseText('Buy FOLLOWERS now!!! https://spam.example/x  ')).toBe('buy followers now');
    expect(normaliseText('🐶🐶')).toBe('');
  });

  describe('account risk', () => {
    const quiet: RiskSignals = {
      accountAgeHours: 24 * 400, phoneVerified: true, sharedNetworkAccounts: 0, flaggedVotes30d: 0, votes24h: 2,
      paymentAnomalies30d: 0, copiedPhotos30d: 0, aiFlags30d: 0, openCases: 0,
    };
    it('an ordinary long-standing account scores 0', () => {
      expect(accountRisk(quiet, 60, 30)).toEqual({ score: 0, level: 'LOW', signals: [] });
    });
    it('shared Wi-Fi alone stays low; a vote ring on a new account is high, with reasons largest first', () => {
      expect(accountRisk({ ...quiet, sharedNetworkAccounts: 4 }, 60, 30).level).toBe('LOW');
      const ring = accountRisk({ ...quiet, accountAgeHours: 3, sharedNetworkAccounts: 12, flaggedVotes30d: 4, votes24h: 40 }, 60, 30);
      expect(ring.score).toBe(15 + 35 + 15 + 15);
      expect(ring.level).toBe('HIGH');
      expect(ring.signals.map((s) => s.signal)).toEqual(['shared_network', 'new_account', 'held_votes', 'vote_burst']); // ties keep their order
      expect(ring.signals[0].detail).toMatch(/12 other accounts/);
    });
    it('caps at 100 and uses the configured thresholds', () => {
      const worst = accountRisk({ accountAgeHours: 1, phoneVerified: false, sharedNetworkAccounts: 50, flaggedVotes30d: 50, votes24h: 99, paymentAnomalies30d: 5, copiedPhotos30d: 9, aiFlags30d: 9, openCases: 9 }, 60, 30);
      expect(worst.score).toBe(100);
      expect(accountRisk({ ...quiet, paymentAnomalies30d: 1, openCases: 1 }, 60, 20).level).toBe('MEDIUM'); // 25
    });
    it('a review covers the score it saw; a rise of 10 or more needs another look', () => {
      expect(needsReview('HIGH', 70, null)).toBe(true);
      expect(needsReview('HIGH', 70, 70)).toBe(false);
      expect(needsReview('HIGH', 79, 70)).toBe(false);
      expect(needsReview('HIGH', 80, 70)).toBe(true);
      expect(needsReview('MEDIUM', 50, null)).toBe(false);
    });
  });

  it('only public networks count as shared', () => {
    for (const ip of ['127.0.0.1', '::1', '10.1.2.3', '192.168.0.4', '172.20.0.1', '169.254.1.1', '::ffff:10.0.0.1', 'fd00::1', 'not-an-ip', null]) expect(isPublicIp(ip)).toBe(false);
    for (const ip of ['49.36.10.4', '172.32.0.1', '2401:4900::1', '::ffff:49.36.10.4']) expect(isPublicIp(ip)).toBe(true);
  });
});
