/**
 * Mask an E.164 number for display: keep the dial code and the last 3 digits,
 * dot out the middle. `+919876543210` -> `+91 ••••••• 210`.
 */
export function maskPhone(e164: string): string {
  const m = /^(\+\d{1,3})(\d+)$/.exec(e164);
  if (!m) return e164;
  const [, dial, rest] = m;
  const tail = rest.slice(-3);
  const dots = '•'.repeat(Math.max(rest.length - 3, 3));
  return `${dial} ${dots} ${tail}`;
}

/** Compact relative time: "just now", "3h ago", "2d ago", "Apr 12". */
export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const secs = Math.round((Date.now() - then) / 1000);
  if (secs < 60) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

export function formatMMSS(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${mm}:${ss.toString().padStart(2, '0')}`;
}
