import {
  GRID_DEFAULT_RADIUS_METERS,
  GRID_RADIUS_METERS,
  distanceBucket,
} from './distance-buckets';

describe('distance buckets', () => {
  describe('distanceBucket', () => {
    it.each([
      [0, '<1 km'],
      [1, '<1 km'],
      [999.9, '<1 km'],
      [1000, '1-3 km'],
      [2999, '1-3 km'],
      [3000, '3-10 km'],
      [9999, '3-10 km'],
      [10000, '10-50 km'],
      [49999, '10-50 km'],
      [50000, '50+ km'],
      [1_000_000, '50+ km'],
    ])('%d m -> %s', (meters, label) => {
      expect(distanceBucket(meters)).toBe(label);
    });

    it('returns a string, never a number', () => {
      // The return type is the guard: a caller cannot accidentally do
      // arithmetic on a label and reconstruct the precision the bucket removed.
      expect(typeof distanceBucket(1234.5678)).toBe('string');
    });

    it('collapses every distance inside a bucket to one indistinguishable label', () => {
      // The point of the whole exercise: an attacker who can observe the label
      // learns only which bucket, not where inside it. If two distances 2 km
      // apart ever produced different labels within one bucket, the bucketing
      // would be leaking.
      const labels = new Set(
        [3000, 4000, 5500, 7250, 9999].map((m) => distanceBucket(m)),
      );
      expect(labels.size).toBe(1);
    });
  });

  describe('permitted radii', () => {
    it('offers exactly one radius per bucket boundary', () => {
      // This is the anti-bracketing invariant. A radius that is NOT a bucket
      // edge lets a caller compare presence at two nearby radii and binary
      // search the true distance, which defeats the labels above entirely.
      // Adding a radius here without a matching bucket reopens that attack.
      expect([...GRID_RADIUS_METERS]).toEqual([1000, 3000, 10000, 50000]);
    });

    it('has every edge land exactly on a bucket transition', () => {
      for (const radius of GRID_RADIUS_METERS) {
        // Just inside the edge and just outside it must report different
        // buckets — that is what makes the edge uninformative: a caller who
        // learns "within 3000m" already knew it from the label.
        expect(distanceBucket(radius - 0.001)).not.toBe(distanceBucket(radius));
      }
    });

    it('defaults to a permitted radius', () => {
      expect([...GRID_RADIUS_METERS]).toContain(GRID_DEFAULT_RADIUS_METERS);
    });
  });
});
