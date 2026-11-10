import { maskPhone, normalizePhone } from './phone';

describe('normalizePhone', () => {
  it.each([
    ['9812345678', '+919812345678'],
    ['+91 98123 45678', '+919812345678'],
    ['09812345678', '+919812345678'],
    ['919812345678', '+919812345678'],
    ['+91-98123-45678', '+919812345678'],
    ['+14155552671', '+14155552671'],
    ['0014155552671', '+14155552671'],
  ])('%s → %s', (input, out) => expect(normalizePhone(input)).toBe(out));

  it.each(['', 'abc', '12345', '+915812345678', '98123456789', '0000000000', '4155552671x9'])('rejects %p', (input) =>
    expect(normalizePhone(input)).toBeNull(),
  );

  it('masks numbers for logs', () => expect(maskPhone('+919812345678')).toBe('+91******5678'));
});
