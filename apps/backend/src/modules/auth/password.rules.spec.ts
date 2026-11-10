import { hashResetToken, newResetToken, passwordProblem, RESET_TOKEN } from './password.rules';

describe('staff password rules', () => {
  it('accepts a long, uncommon password or phrase', () => {
    expect(passwordProblem('correct horse battery staple')).toBeNull();
    expect(passwordProblem('Tq8#mVz2!pLr', { email: 'asha@petapp.in', name: 'Asha Rao' })).toBeNull();
  });

  it('refuses short, common, repetitive and personal passwords', () => {
    expect(passwordProblem('short1!')).toMatch(/at least 12/);
    expect(passwordProblem('x'.repeat(129))).toMatch(/at most 128/);
    expect(passwordProblem(' leading space ok?')).toMatch(/space/);
    expect(passwordProblem('aaaaaaaabbbbbbbb')).toMatch(/different characters/);
    expect(passwordProblem('password1234')).toMatch(/too common/);
    expect(passwordProblem('Password2026!')).toMatch(/too common/);
    expect(passwordProblem('ChangeMe-Admin-2026')).toMatch(/too common/);
    expect(passwordProblem('abcdabcdabcdabcd')).toMatch(/different characters|repeating/);
    expect(passwordProblem('pet9!kpet9!kpet9!k')).toMatch(/repeating/);
    expect(passwordProblem('ashwini.k-portal-77', { email: 'ashwini.k@petapp.in' })).toMatch(/email/);
    expect(passwordProblem('my-dog-Bruno-Ramesh-9', { name: 'Ramesh Iyer' })).toMatch(/name/);
  });

  it('makes reset tokens that are only stored hashed', () => {
    const a = newResetToken();
    const b = newResetToken();
    expect(a.token).toMatch(RESET_TOKEN);
    expect(a.token).not.toBe(b.token);
    expect(a.hash).toBe(hashResetToken(a.token));
    expect(a.hash).not.toContain(a.token);
    expect(RESET_TOKEN.test('short')).toBe(false);
  });
});
