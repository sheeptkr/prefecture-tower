import { describe, expect, it } from 'vitest';
import { loadRecords, saveRecords } from '../src/storage';

describe('record persistence', () => {
  it('round-trips score and height', () => {
    let value: string | null = null;
    const storage = {
      getItem: () => value,
      setItem: (_key: string, next: string) => { value = next; },
    };
    saveRecords({ bestScore: 12, bestHeightKm: 456.7 }, storage);
    expect(loadRecords(storage)).toEqual({ bestScore: 12, bestHeightKm: 456.7 });
  });

  it('recovers safely from corrupt values', () => {
    expect(loadRecords({ getItem: () => '{broken' })).toEqual({ bestScore: 0, bestHeightKm: 0 });
  });
});
