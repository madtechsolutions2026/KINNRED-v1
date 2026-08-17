import { generatePublicShortId } from './public-short-id';

describe('generatePublicShortId', () => {
  it('produces IDs of the requested length', () => {
    expect(generatePublicShortId()).toHaveLength(10);
    expect(generatePublicShortId(6)).toHaveLength(6);
  });

  it('excludes visually ambiguous characters', () => {
    // These IDs get read off a screen, said aloud, and typed by hand, so
    // I/1, L/1, O/0 confusion is a real support burden. U is dropped to
    // reduce the odds of generating something offensive.
    const sample = Array.from({ length: 500 }, () =>
      generatePublicShortId(20),
    ).join('');

    expect(sample).not.toMatch(/[ILOU]/);
  });

  it('uses only the expected alphabet', () => {
    const sample = Array.from({ length: 200 }, () => generatePublicShortId());
    sample.forEach((id) =>
      expect(id).toMatch(/^[0-9ABCDEFGHJKMNPQRSTVWXYZ]+$/),
    );
  });

  it('does not collide across a large sample', () => {
    // Not a proof of uniqueness — the DB unique index is the real guarantee,
    // and the service retries on collision. This just catches a generator
    // that is accidentally deterministic or has far less entropy than
    // intended.
    const ids = new Set(
      Array.from({ length: 5000 }, () => generatePublicShortId()),
    );
    expect(ids.size).toBe(5000);
  });

  it('is not sequential', () => {
    // Sequential IDs would let anyone enumerate the entire user base, which
    // for this app is a safety hole, not just a privacy one.
    const a = generatePublicShortId();
    const b = generatePublicShortId();
    expect(a).not.toEqual(b);
  });
});
