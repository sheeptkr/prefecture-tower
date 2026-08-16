import type { PersistedRecords } from './types';

const key = 'prefecture-tower:records:v1';
const emptyRecords: PersistedRecords = { bestScore: 0, bestHeightKm: 0 };

export function loadRecords(storage?: Pick<Storage, 'getItem'>): PersistedRecords {
  const target = storage ?? (typeof localStorage === 'undefined' ? undefined : localStorage);
  if (!target) return { ...emptyRecords };
  try {
    const parsed = JSON.parse(target.getItem(key) ?? '') as Partial<PersistedRecords>;
    return {
      bestScore: Number.isFinite(parsed.bestScore) ? Math.max(0, Math.floor(parsed.bestScore!)) : 0,
      bestHeightKm: Number.isFinite(parsed.bestHeightKm) ? Math.max(0, parsed.bestHeightKm!) : 0,
    };
  } catch {
    return { ...emptyRecords };
  }
}

export function saveRecords(records: PersistedRecords, storage?: Pick<Storage, 'setItem'>): void {
  const target = storage ?? (typeof localStorage === 'undefined' ? undefined : localStorage);
  if (!target) return;
  try {
    target.setItem(key, JSON.stringify(records));
  } catch {
    // The game remains playable when storage is unavailable or full.
  }
}
