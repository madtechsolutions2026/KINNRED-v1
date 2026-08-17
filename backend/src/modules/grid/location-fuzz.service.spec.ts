import { LocationFuzzService } from './location-fuzz.service';
import type { AppConfig } from '../../config/env.schema';

const configWith = (over: Partial<AppConfig> = {}): AppConfig =>
  ({
    GRID_LOCATION_SALT: 'test-salt-that-is-at-least-32-characters-long',
    GRID_FUZZ_MIN_METERS: 100,
    GRID_FUZZ_MAX_METERS: 300,
    ...over,
  }) as AppConfig;

describe('LocationFuzzService', () => {
  describe('determinism — the property the whole fuzzing scheme rests on', () => {
    it('returns an identical offset across many calls for the same user', () => {
      const fuzz = new LocationFuzzService(configWith());

      const first = fuzz.offsetFor('user-a');

      // 100 polls is the attack in CLAUDE.md §2.2: with random jitter the
      // averaged error collapses by sqrt(100) = 10x. Here every sample must be
      // byte-identical, so averaging them yields exactly the single sample.
      for (let i = 0; i < 100; i += 1) {
        expect(fuzz.offsetFor('user-a')).toEqual(first);
      }
    });

    it('survives a fresh service instance — nothing is held in memory', () => {
      const a = new LocationFuzzService(configWith()).offsetFor('user-a');
      const b = new LocationFuzzService(configWith()).offsetFor('user-a');

      // A restart, a second API instance, and a worker process must all agree,
      // or the same user's fuzzed point jumps depending on who wrote it.
      expect(b).toEqual(a);
    });

    it('gives different users different offsets', () => {
      const fuzz = new LocationFuzzService(configWith());

      // Not a security property on its own, but a shared offset would mean two
      // users at the same true point are also at the same fuzzed point, and
      // the whole population could be translated back by one measurement.
      expect(fuzz.offsetFor('user-a')).not.toEqual(fuzz.offsetFor('user-b'));
    });

    it('changes for every user when the salt is rotated', () => {
      const before = new LocationFuzzService(configWith()).offsetFor('user-a');
      const after = new LocationFuzzService(
        configWith({
          GRID_LOCATION_SALT: 'a-different-salt-of-at-least-32-chars',
        }),
      ).offsetFor('user-a');

      expect(after).not.toEqual(before);
    });
  });

  describe('magnitude', () => {
    it('stays within the configured range for a large sample of users', () => {
      const fuzz = new LocationFuzzService(configWith());

      for (let i = 0; i < 2000; i += 1) {
        const { distanceMeters, bearingRadians } = fuzz.offsetFor(`user-${i}`);

        expect(distanceMeters).toBeGreaterThanOrEqual(100);
        expect(distanceMeters).toBeLessThanOrEqual(300);
        expect(bearingRadians).toBeGreaterThanOrEqual(0);
        expect(bearingRadians).toBeLessThan(2 * Math.PI);
      }
    });

    it('never produces a zero displacement', () => {
      const fuzz = new LocationFuzzService(configWith());

      // A zero offset publishes the exact point. The configured minimum is what
      // prevents it, and the schema forbids a minimum below 50m.
      for (let i = 0; i < 2000; i += 1) {
        expect(fuzz.offsetFor(`user-${i}`).distanceMeters).toBeGreaterThan(0);
      }
    });

    it('spreads bearings around the full circle', () => {
      const fuzz = new LocationFuzzService(configWith());
      const quadrants = new Set<number>();

      for (let i = 0; i < 200; i += 1) {
        const { bearingRadians } = fuzz.offsetFor(`user-${i}`);
        quadrants.add(Math.floor(bearingRadians / (Math.PI / 2)));
      }

      // Clustered bearings would make the displacement partially predictable
      // without knowing the salt — subtract the mean direction and the error
      // shrinks.
      expect(quadrants.size).toBe(4);
    });
  });
});
