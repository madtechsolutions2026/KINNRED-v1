/** Format raw digits as DD/MM/YYYY progressively. */
export function formatDobInput(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 8);
  const parts = [d.slice(0, 2), d.slice(2, 4), d.slice(4, 8)].filter(Boolean);
  return parts.join('/');
}

export interface DobResult {
  iso: string | null; // YYYY-MM-DD
  error: string | null;
}

/** Validate a DD/MM/YYYY string and return an ISO date + an 18+ check. */
export function parseDob(display: string): DobResult {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(display);
  if (!m) return { iso: null, error: null };

  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);

  const date = new Date(year, month - 1, day);
  const valid =
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day;
  if (!valid) return { iso: null, error: 'That date doesn’t exist.' };

  const now = new Date();
  let age = now.getFullYear() - year;
  const beforeBirthday =
    now.getMonth() < month - 1 ||
    (now.getMonth() === month - 1 && now.getDate() < day);
  if (beforeBirthday) age -= 1;

  if (age < 18) return { iso: null, error: 'You must be 18 or older to join.' };
  if (age > 120) return { iso: null, error: 'Please enter a real date of birth.' };

  const iso = `${m[3]}-${m[2]}-${m[1]}`;
  return { iso, error: null };
}
