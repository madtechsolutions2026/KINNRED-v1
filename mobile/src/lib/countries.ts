/**
 * A short list of dial codes for the phone-entry screen. Not exhaustive — the
 * backend normalises and validates E.164 anyway (auth RequestOtpDto), this is
 * just the picker UI. India first: it is the launch market and the API's own
 * examples use +91.
 */
export interface Country {
  code: string; // ISO 3166-1 alpha-2
  name: string;
  dial: string; // with leading '+'
  flag: string; // emoji
  /** Expected national number length, for a soft "looks complete" hint. */
  nsnLength: number;
}

export const COUNTRIES: Country[] = [
  { code: 'IN', name: 'India', dial: '+91', flag: '🇮🇳', nsnLength: 10 },
  { code: 'US', name: 'United States', dial: '+1', flag: '🇺🇸', nsnLength: 10 },
  { code: 'GB', name: 'United Kingdom', dial: '+44', flag: '🇬🇧', nsnLength: 10 },
  { code: 'CA', name: 'Canada', dial: '+1', flag: '🇨🇦', nsnLength: 10 },
  { code: 'AU', name: 'Australia', dial: '+61', flag: '🇦🇺', nsnLength: 9 },
  { code: 'AE', name: 'United Arab Emirates', dial: '+971', flag: '🇦🇪', nsnLength: 9 },
  { code: 'SG', name: 'Singapore', dial: '+65', flag: '🇸🇬', nsnLength: 8 },
  { code: 'DE', name: 'Germany', dial: '+49', flag: '🇩🇪', nsnLength: 11 },
  { code: 'FR', name: 'France', dial: '+33', flag: '🇫🇷', nsnLength: 9 },
  { code: 'NL', name: 'Netherlands', dial: '+31', flag: '🇳🇱', nsnLength: 9 },
  { code: 'ES', name: 'Spain', dial: '+34', flag: '🇪🇸', nsnLength: 9 },
  { code: 'IT', name: 'Italy', dial: '+39', flag: '🇮🇹', nsnLength: 10 },
  { code: 'BR', name: 'Brazil', dial: '+55', flag: '🇧🇷', nsnLength: 11 },
  { code: 'MX', name: 'Mexico', dial: '+52', flag: '🇲🇽', nsnLength: 10 },
  { code: 'JP', name: 'Japan', dial: '+81', flag: '🇯🇵', nsnLength: 10 },
  { code: 'KR', name: 'South Korea', dial: '+82', flag: '🇰🇷', nsnLength: 10 },
  { code: 'ID', name: 'Indonesia', dial: '+62', flag: '🇮🇩', nsnLength: 10 },
  { code: 'PH', name: 'Philippines', dial: '+63', flag: '🇵🇭', nsnLength: 10 },
  { code: 'ZA', name: 'South Africa', dial: '+27', flag: '🇿🇦', nsnLength: 9 },
  { code: 'NG', name: 'Nigeria', dial: '+234', flag: '🇳🇬', nsnLength: 10 },
];

export const DEFAULT_COUNTRY = COUNTRIES[0];

/** Build an E.164 string from a dial code and a raw national number. */
export function toE164(dial: string, nationalNumber: string): string {
  const digits = nationalNumber.replace(/\D/g, '');
  return `${dial}${digits}`;
}
