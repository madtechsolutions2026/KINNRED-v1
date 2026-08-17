import { maskPhone, normalizeToE164 } from './phone.util';

describe('normalizeToE164', () => {
  it('collapses different spellings of one number to a single canonical form', () => {
    // The point of normalising: User.phone is UNIQUE, and without this these
    // would be three distinct rows for one person — defeating per-phone rate
    // limits and bans.
    const variants = ['+919876543210', '+91 98765 43210', '+91-98765-43210'];
    const normalized = variants.map(normalizeToE164);

    expect(new Set(normalized).size).toBe(1);
    expect(normalized[0]).toBe('+919876543210');
  });

  it('rejects numbers without a country code', () => {
    // We deliberately do not guess a default region — guessing turns a typo
    // into someone else's number.
    expect(normalizeToE164('9876543210')).toBeNull();
    expect(normalizeToE164('09876543210')).toBeNull();
  });

  it('rejects invalid input', () => {
    expect(normalizeToE164('not-a-phone')).toBeNull();
    expect(normalizeToE164('')).toBeNull();
    expect(normalizeToE164('+1')).toBeNull();
  });

  it('handles other country codes', () => {
    expect(normalizeToE164('+44 20 7946 0958')).toBe('+442079460958');
  });
});

describe('maskPhone', () => {
  it('hides the middle digits', () => {
    const masked = maskPhone('+919876543210');
    expect(masked).toContain('•');
    expect(masked).not.toBe('+919876543210');
  });

  it('keeps enough for a user to recognise their own number', () => {
    expect(maskPhone('+919876543210')).toMatch(/^\+91987/);
    expect(maskPhone('+919876543210')).toMatch(/10$/);
  });

  it('does not leak short values', () => {
    expect(maskPhone('+1234')).toBe('•••••');
  });
});
