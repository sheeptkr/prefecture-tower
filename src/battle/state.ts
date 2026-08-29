import {
  BATTLE_ATTACK_TIME_MS,
  BATTLE_ATTACK_REVEAL_MS,
  BATTLE_PLATFORM_WIDTH_SCALE,
  BATTLE_PREFECTURE_ATTACK_INTERVAL,
  BATTLE_PREFECTURE_ATTACK_START,
  BATTLE_TURN_TIME_MS,
} from '../constants';
import { SeededRandom } from '../random';
import type { PrefectureAssetCollection, SerializedPiece } from '../types';
import type { AttackCard, BattlePhase, PlayerNumber } from './protocol';

export type HintFact = { id: string; category: string; text: string; difficulty: number };
export type PrefectureHints = { prefectureCode: string; facts: HintFact[] };

export type StoredPlayer = {
  number: PlayerNumber;
  token: string;
  connected: boolean;
  disconnectedAt: number | null;
};

export type StoredBattle = {
  roomId: string;
  phase: BattlePhase;
  players: StoredPlayer[];
  turn: PlayerNumber | null;
  currentPrefectureCode: string | null;
  nextPrefectureCode: string | null;
  forcedPrefectureCode: string | null;
  placement: { x: number; angle: number };
  dropSequence: number;
  score: number;
  heightKm: number;
  deadline: number | null;
  board: SerializedPiece[];
  attackCards: AttackCard[];
  attackPlayer: PlayerNumber | null;
  revealedAttackCardId: string | null;
  winner: PlayerNumber | null;
  loser: PlayerNumber | null;
  rematchReady: PlayerNumber[];
  matchNumber: number;
  seed: number;
  randomState: number;
  lastAttackScore: number;
  updatedAt: number;
};

export type BattleEffect = 'none' | 'drop' | 'dropResolved' | 'attackRevealed' | 'attackResolved';

const otherPlayer = (player: PlayerNumber): PlayerNumber => player === 1 ? 2 : 1;

export function shouldStartAttack(score: number): boolean {
  return score >= BATTLE_PREFECTURE_ATTACK_START
    && (score - BATTLE_PREFECTURE_ATTACK_START) % BATTLE_PREFECTURE_ATTACK_INTERVAL === 0;
}

export class BattleStateMachine {
  readonly state: StoredBattle;
  private readonly random: SeededRandom;
  private readonly assetsByCode: Map<string, PrefectureAssetCollection['assets'][number]>;
  private readonly hintsByCode: Map<string, PrefectureHints>;
  private readonly platformWidth: number;

  constructor(
    roomId: string,
    seed: number,
    data: PrefectureAssetCollection,
    hints: PrefectureHints[],
    stored?: StoredBattle,
  ) {
    this.assetsByCode = new Map(data.assets.map((asset) => [asset.code, asset]));
    this.hintsByCode = new Map(hints.map((entry) => [entry.prefectureCode, entry]));
    this.platformWidth = Math.max(...data.assets.map((asset) => asset.mainBounds.width)) * 1.1 * BATTLE_PLATFORM_WIDTH_SCALE;
    this.state = stored ?? {
      roomId,
      phase: 'waiting',
      players: [],
      turn: null,
      currentPrefectureCode: null,
      nextPrefectureCode: null,
      forcedPrefectureCode: null,
      placement: { x: 0, angle: 0 },
      dropSequence: 0,
      score: 0,
      heightKm: 0,
      deadline: null,
      board: [],
      attackCards: [],
      attackPlayer: null,
      revealedAttackCardId: null,
      winner: null,
      loser: null,
      rematchReady: [],
      matchNumber: 1,
      seed,
      randomState: seed,
      lastAttackScore: 0,
      updatedAt: Date.now(),
    };
    this.state.rematchReady ??= [];
    this.state.matchNumber ??= 1;
    this.state.revealedAttackCardId ??= null;
    // Older rooms reset this value at every turn. Raise it to at least the
    // committed piece count so the next drop gets a fresh animation id.
    this.state.dropSequence = Math.max(this.state.dropSequence ?? 0, this.state.score ?? 0);
    this.random = new SeededRandom(this.state.seed, this.state.randomState);
  }

  addPlayer(token: string, now: number): StoredPlayer | null {
    const reconnecting = this.state.players.find((player) => player.token === token);
    if (reconnecting) {
      reconnecting.connected = true;
      reconnecting.disconnectedAt = null;
      this.touch(now);
      return reconnecting;
    }
    if (this.state.players.length >= 2) return null;
    const player: StoredPlayer = {
      number: this.state.players.length === 0 ? 1 : 2,
      token,
      connected: true,
      disconnectedAt: null,
    };
    this.state.players.push(player);
    if (this.state.players.length === 2) this.start(now);
    this.touch(now);
    return player;
  }

  disconnect(playerNumber: PlayerNumber, now: number): void {
    const player = this.state.players.find((candidate) => candidate.number === playerNumber);
    if (!player) return;
    player.connected = false;
    player.disconnectedAt = now;
    this.touch(now);
  }

  leave(playerNumber: PlayerNumber, now: number): void {
    if (this.state.phase === 'gameOver') return;
    this.finish(otherPlayer(playerNumber), playerNumber, now);
  }

  move(playerNumber: PlayerNumber, direction: -1 | 1, now: number): boolean {
    if (!this.canPlace(playerNumber, now) || !this.state.currentPrefectureCode) return false;
    const asset = this.assetsByCode.get(this.state.currentPrefectureCode)!;
    const step = Math.max(8, this.platformWidth * 0.035);
    const overhang = asset.mainBounds.width * 0.5;
    const minimum = -this.platformWidth / 2 - asset.mainBounds.min.x - overhang;
    const maximum = this.platformWidth / 2 - asset.mainBounds.max.x + overhang;
    this.state.placement.x = Math.min(maximum, Math.max(minimum, this.state.placement.x + direction * step));
    this.touch(now);
    return true;
  }

  rotate(playerNumber: PlayerNumber, direction: -1 | 1, now: number): boolean {
    if (!this.canPlace(playerNumber, now)) return false;
    this.state.placement.angle += direction * Math.PI / 12;
    this.touch(now);
    return true;
  }

  requestDrop(playerNumber: PlayerNumber, now: number): boolean {
    if (this.state.phase !== 'placing' || this.state.turn !== playerNumber) return false;
    this.state.phase = 'dropping';
    this.state.dropSequence += 1;
    this.state.deadline = null;
    this.touch(now);
    return true;
  }

  stageDrop(durationMs: number, now: number): void {
    if (this.state.phase !== 'dropping') return;
    this.state.deadline = now + Math.max(this.fixedStepDuration(), durationMs);
    this.touch(now);
  }

  completeDrop(board: SerializedPiece[], heightKm: number, gameOver: boolean, now: number): void {
    const droppingPlayer = this.state.turn;
    if (!droppingPlayer || (this.state.phase !== 'placing' && this.state.phase !== 'dropping')) return;
    this.state.board = board;
    this.state.score = board.length;
    this.state.heightKm = heightKm;
    if (gameOver) {
      this.finish(otherPlayer(droppingPlayer), droppingPlayer, now);
      return;
    }
    if (shouldStartAttack(this.state.score) && this.state.lastAttackScore !== this.state.score) {
      this.state.lastAttackScore = this.state.score;
      this.state.phase = 'prefectureAttack';
      this.state.attackPlayer = droppingPlayer;
      this.state.attackCards = this.createAttackCards();
      this.state.deadline = now + BATTLE_ATTACK_TIME_MS;
      this.touch(now);
      return;
    }
    this.startTurn(otherPlayer(droppingPlayer), now);
  }

  selectAttack(playerNumber: PlayerNumber, cardId: string, now: number): boolean {
    if (this.state.phase !== 'prefectureAttack' || this.state.attackPlayer !== playerNumber || now > (this.state.deadline ?? 0)) return false;
    const card = this.state.attackCards.find((candidate) => candidate.id === cardId);
    if (!card) return false;
    this.revealAttack(card, now);
    return true;
  }

  requestRematch(playerNumber: PlayerNumber, now: number): boolean {
    if (this.state.phase !== 'gameOver' || !this.state.players.some((player) => player.number === playerNumber)) return false;
    if (!this.state.rematchReady.includes(playerNumber)) this.state.rematchReady.push(playerNumber);
    if (this.state.players.length === 2 && this.state.players.every((player) => this.state.rematchReady.includes(player.number))) {
      this.resetMatch(now);
    } else {
      this.touch(now);
    }
    return true;
  }

  expire(now: number): BattleEffect {
    if (this.state.deadline === null || now < this.state.deadline) return 'none';
    if (this.state.phase === 'placing') {
      this.state.phase = 'dropping';
      this.state.dropSequence += 1;
      this.state.deadline = null;
      this.touch(now);
      return 'drop';
    }
    if (this.state.phase === 'dropping') return 'dropResolved';
    if (this.state.phase === 'prefectureAttack') {
      const card = this.state.attackCards[this.random.integer(this.state.attackCards.length)];
      if (card) this.revealAttack(card, now);
      return 'attackRevealed';
    }
    if (this.state.phase === 'prefectureAttackReveal') {
      this.completeAttackReveal(now);
      return 'attackResolved';
    }
    return 'none';
  }

  private start(now: number): void {
    const first = this.random.integer(2) === 0 ? 1 : 2;
    this.state.currentPrefectureCode = this.drawCode();
    this.state.nextPrefectureCode = this.drawCode();
    this.startTurn(first, now, false);
  }

  private startTurn(player: PlayerNumber, now: number, advancePiece = true): void {
    if (advancePiece) {
      this.state.currentPrefectureCode = this.state.forcedPrefectureCode ?? this.state.nextPrefectureCode ?? this.drawCode();
      this.state.forcedPrefectureCode = null;
      this.state.nextPrefectureCode = this.drawCode();
    }
    this.state.phase = 'placing';
    this.state.turn = player;
    this.state.placement = { x: 0, angle: 0 };
    this.state.deadline = now + BATTLE_TURN_TIME_MS;
    this.state.attackCards = [];
    this.state.attackPlayer = null;
    this.state.revealedAttackCardId = null;
    this.touch(now);
  }

  private revealAttack(card: AttackCard, now: number): void {
    if (!this.state.attackPlayer) return;
    this.state.forcedPrefectureCode = card.prefectureCode;
    this.state.revealedAttackCardId = card.id;
    this.state.phase = 'prefectureAttackReveal';
    this.state.deadline = now + BATTLE_ATTACK_REVEAL_MS;
    this.touch(now);
  }

  private completeAttackReveal(now: number): void {
    const attacker = this.state.attackPlayer;
    if (!attacker) return;
    this.startTurn(otherPlayer(attacker), now);
  }

  private createAttackCards(): AttackCard[] {
    const codes: string[] = [];
    while (codes.length < 4) {
      const code = this.drawCode();
      if (!codes.includes(code)) codes.push(code);
    }
    return codes.map((code, index) => {
      const facts = this.hintsByCode.get(code)?.facts ?? [];
      const selected = facts.length > 0 ? [facts[this.random.integer(facts.length)]!.text] : [];
      return { id: `${this.state.score}-${index}-${this.random.integer(1_000_000)}`, prefectureCode: code, hints: selected };
    });
  }

  private canPlace(playerNumber: PlayerNumber, now: number): boolean {
    return this.state.phase === 'placing' && this.state.turn === playerNumber && now <= (this.state.deadline ?? 0);
  }

  private drawCode(): string {
    const codes = [...this.assetsByCode.keys()];
    return codes[this.random.integer(codes.length)]!;
  }

  private finish(winner: PlayerNumber, loser: PlayerNumber, now: number): void {
    this.state.phase = 'gameOver';
    this.state.winner = winner;
    this.state.loser = loser;
    this.state.rematchReady = [];
    this.state.attackCards = [];
    this.state.attackPlayer = null;
    this.state.revealedAttackCardId = null;
    this.state.forcedPrefectureCode = null;
    this.state.deadline = null;
    this.touch(now);
  }

  private resetMatch(now: number): void {
    this.state.matchNumber += 1;
    this.state.seed = Math.floor(this.random.next() * 4294967296) >>> 0;
    this.state.phase = 'waiting';
    this.state.turn = null;
    this.state.currentPrefectureCode = null;
    this.state.nextPrefectureCode = null;
    this.state.forcedPrefectureCode = null;
    this.state.placement = { x: 0, angle: 0 };
    this.state.score = 0;
    this.state.heightKm = 0;
    this.state.deadline = null;
    this.state.board = [];
    this.state.attackCards = [];
    this.state.attackPlayer = null;
    this.state.revealedAttackCardId = null;
    this.state.winner = null;
    this.state.loser = null;
    this.state.rematchReady = [];
    this.state.lastAttackScore = 0;
    this.start(now);
  }

  private touch(now: number): void {
    this.state.randomState = this.random.snapshot();
    this.state.updatedAt = now;
  }

  private fixedStepDuration(): number {
    return 1000 / 60;
  }
}
