export const DEPLOYED_BATTLE_API_URL = 'https://prefecture-tower-battle.guragura-toybox.workers.dev';

export function resolveBattleApiBase(configured: string | undefined, hostname: string): string {
  const normalized = configured?.trim().replace(/\/$/, '');
  if (normalized) return normalized;
  if (hostname === 'localhost' || hostname === '127.0.0.1') return 'http://localhost:8787';
  return DEPLOYED_BATTLE_API_URL;
}
