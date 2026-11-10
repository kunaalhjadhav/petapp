/**
 * Normalises a phone number to E.164.
 * Numbers without a country code use DEFAULT_COUNTRY_CODE (91 = India).
 * Indian mobile numbers must be 10 digits starting with 6–9.
 * Returns null when the input is not a valid number.
 */
export function normalizePhone(input: string, defaultCountryCode = '91'): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  const hasPlus = trimmed.startsWith('+');
  let digits = trimmed.replace(/[^\d]/g, '');
  if (!digits) return null;

  if (!hasPlus) {
    if (digits.startsWith('00')) {
      digits = digits.slice(2); // explicit international prefix
    } else {
      // Without "+" or "00" the number must belong to the default country.
      const national = digits.replace(/^0+/, '');
      if (national.length === 10) digits = defaultCountryCode + national;
      else if (national.startsWith(defaultCountryCode) && national.length === defaultCountryCode.length + 10) digits = national;
      else return null;
    }
  }

  if (digits.startsWith('91')) {
    const national = digits.slice(2);
    return /^[6-9]\d{9}$/.test(national) ? `+91${national}` : null;
  }
  return /^[1-9]\d{7,14}$/.test(digits) ? `+${digits}` : null;
}

export function maskPhone(e164: string): string {
  return e164.length > 6 ? `${e164.slice(0, 3)}******${e164.slice(-4)}` : '****';
}
