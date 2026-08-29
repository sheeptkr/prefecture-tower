import { describe, expect, it } from 'vitest';
import { DEPLOYED_BATTLE_API_URL, resolveBattleApiBase } from '../src/battle/config';

describe('battle API configuration', () => {
  it('uses the deployed Worker when a production build has no injected environment variable', () => {
    expect(resolveBattleApiBase(undefined, 'prefecture-tower-preview.pages.dev')).toBe(DEPLOYED_BATTLE_API_URL);
  });

  it('keeps the local Worker default and honors an explicit override', () => {
    expect(resolveBattleApiBase(undefined, 'localhost')).toBe('http://localhost:8787');
    expect(resolveBattleApiBase('https://example.workers.dev/', 'prefecture-tower-preview.pages.dev')).toBe('https://example.workers.dev');
  });
});
