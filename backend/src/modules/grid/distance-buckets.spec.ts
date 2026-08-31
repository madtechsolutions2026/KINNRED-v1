import {
  GRID_DEFAULT_RADIUS_METERS,
  GRID_RADIUS_METERS,
  distanceLabel,
} from './distance-buckets';

describe('distance label', () => {
  describe('distanceLabel', () => {
    it.each([
      [0, '1 km'],
      [1, '1 km'],
      [499, '1 km'],
      [900, '1 km'],
      [1000, '1 km'],
      [1499, '1 km'],
      [1500, '2 km'],
      [2400, '2 km'],
      [2500, '3 km'],
      [20500, '21 km'],
      [49999, '50 km'],
    ])('%d m -> %s', (meters, label) => {
      expect(distanceLabel(meters)).toBe(label);
    });

    it('never reports a sub-kilometre distance', () => {
      // The highest-stakes case: someone within walking distance. 120 m and
      // 900 m must be indistinguishable from the label.
      const labels = new Set(
        [10, 120, 400, 700, 999].map((m) => distanceLabel(m)),
      );
      expect(labels).toEqual(new Set(['1 km']));
    });

    it('returns a string, never a number', () => {
      // The return type is the guard: a caller cannot accidentally do
      // arithmetic on a label and reconstruct the precision rounding removed.
      expect(typeof distanceLabel(1234.5678)).toBe('string');
    });

    it('rounds to the nearest kilometre beyond 1 km', () => {
      // 1 km steps sit above the 100-300 m fuzz, so the label moves in
      // increments larger than the displacement it would need to resolve.
      expect(distanceLabel(6400)).toBe('6 km');
      expect(distanceLabel(6600)).toBe('7 km');
    });
  });

  describe('permitted radii', () => {
    it('offers a fixed, small set of radii', () => {
      // The anti-bracketing invariant. A free-form radius lets a caller compare
      // presence at two nearby radii and binary-search the true distance, which
      // defeats the rounding. Adding a radius here widens that surface.
      expect([...GRID_RADIUS_METERS]).toEqual([1000, 3000, 10000, 50000]);
    });

    it('defaults to a permitted radius', () => {
      expect([...GRID_RADIUS_METERS]).toContain(GRID_DEFAULT_RADIUS_METERS);
    });
  });
});
