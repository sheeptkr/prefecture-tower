import type { SerializedPiece } from '../types';

export type PlayerNumber = 1 | 2;
export type BattlePhase = 'waiting' | 'placing' | 'dropping' | 'prefectureAttack' | 'prefectureAttackReveal' | 'gameOver';

export type AttackCard = {
  id: string;
  prefectureCode: string;
  hints: string[];
};

export type PublicAttackCard = Omit<AttackCard, 'prefectureCode'> & {
  answerPrefectureName: string | null;
};

export type BattlePlayer = {
  number: PlayerNumber;
  connected: boolean;
};

export type BattleView = {
  roomId: string;
  phase: BattlePhase;
  players: BattlePlayer[];
  you: PlayerNumber;
  turn: PlayerNumber | null;
  currentPrefectureCode: string | null;
  nextPrefectureCode: string | null;
  placement: { x: number; angle: number };
  dropSequence: number;
  score: number;
  heightKm: number;
  deadline: number | null;
  board: SerializedPiece[];
  attackCards: PublicAttackCard[];
  attackPlayer: PlayerNumber | null;
  winner: PlayerNumber | null;
  loser: PlayerNumber | null;
  rematchReady: PlayerNumber[];
  matchNumber: number;
  seed: number;
};

export type ClientMessage =
  | { type: 'join'; reconnectToken?: string }
  | { type: 'move'; direction: -1 | 1 }
  | { type: 'rotate'; direction: -1 | 1 }
  | { type: 'drop' }
  | { type: 'dropComplete'; dropSequence: number }
  | { type: 'attackSelect'; cardId: string }
  | { type: 'rematch' }
  | { type: 'leave' }
  | { type: 'ping' };

export type ServerMessage =
  | { type: 'joined'; reconnectToken: string; state: BattleView }
  | { type: 'roomState'; state: BattleView }
  | { type: 'error'; code: string; message: string }
  | { type: 'pong'; serverTime: number };

export type CreateRoomResponse = { roomId: string };

export function parseClientMessage(value: string): ClientMessage | null {
  try {
    const parsed = JSON.parse(value) as Partial<ClientMessage>;
    if (parsed.type === 'join' && (parsed.reconnectToken === undefined || typeof parsed.reconnectToken === 'string')) return parsed as ClientMessage;
    if ((parsed.type === 'move' || parsed.type === 'rotate') && (parsed.direction === -1 || parsed.direction === 1)) return parsed as ClientMessage;
    if (parsed.type === 'drop' || parsed.type === 'rematch' || parsed.type === 'leave' || parsed.type === 'ping') return parsed as ClientMessage;
    if (parsed.type === 'dropComplete' && Number.isSafeInteger(parsed.dropSequence) && Number(parsed.dropSequence) >= 0) return parsed as ClientMessage;
    if (parsed.type === 'attackSelect' && typeof parsed.cardId === 'string') return parsed as ClientMessage;
  } catch {
    // Invalid client input is rejected by returning null.
  }
  return null;
}
