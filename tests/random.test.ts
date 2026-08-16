import { describe, expect, it } from 'vitest';
import { normalizeSeed, SeededRandom } from '../src/random';

describe('seeded random sequence', () => {
  it('repeats exactly for the same seed', () => {
    const first = new SeededRandom(20260401);
    const second = new SeededRandom(20260401);
    expect(Array.from({ length: 100 }, () => first.integer(47))).toEqual(Array.from({ length: 100 }, () => second.integer(47)));
  });

  it('allows independent repeated prefecture draws', () => {
    const random = new SeededRandom(7);
    const sequence = Array.from({ length: 200 }, () => random.integer(47));
    expect(sequence.some((value, index) => index > 0 && value === sequence[index - 1])).toBe(true);
    expect(sequence.every((value) => value >= 0 && value < 47)).toBe(true);
  });

  it('normalizes numeric and text URL seeds', () => {
    expect(normalizeSeed('123')).toBe(123);
    expect(normalizeSeed('tower')).toBe(normalizeSeed('tower'));
    expect(normalizeSeed('tower')).not.toBe(normalizeSeed('other'));
  });
});
