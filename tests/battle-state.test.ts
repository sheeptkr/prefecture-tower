import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BATTLE_ATTACK_REVEAL_MS, BATTLE_TURN_TIME_MS } from '../src/constants';
import { BattleStateMachine, shouldStartAttack } from '../src/battle/state';
import { resolveAuthoritativeDrop } from '../src/battle/physics';
import { PrefectureTowerGame } from '../src/game';
import type { PrefectureHints } from '../src/battle/state';
import type { PrefectureAssetCollection, SerializedPiece } from '../src/types';

const data = JSON.parse(readFileSync(new URL('../public/assets/prefectures.json', import.meta.url), 'utf8')) as PrefectureAssetCollection;
const hints = (JSON.parse(readFileSync(new URL('../public/assets/prefecture-hints.json', import.meta.url), 'utf8')) as { records: PrefectureHints[] }).records;
const piece = (index: number): SerializedPiece => ({
  prefectureCode: data.assets[index % data.assets.length]!.code,
  position: { x: index, y: -index },
  angle: 0,
  velocity: { x: 0, y: 0 },
  angularVelocity: 0,
  isSleeping: true,
});

function started(seed = 123, now = 1_000): BattleStateMachine {
  const battle = new BattleStateMachine('ABC234', seed, data, hints);
  battle.addPlayer('one', now);
  battle.addPlayer('two', now);
  return battle;
}

describe('battle state machine', () => {
  it('reproduces the authoritative Matter.js result within floating-point tolerance', () => {
    const first = resolveAuthoritativeDrop(data, 77, [], '13', { x: 0, angle: 0 });
    const second = resolveAuthoritativeDrop(data, 77, [], '13', { x: 0, angle: 0 });
    expect(first.board).toHaveLength(1);
    expect(first.gameOver).toBe(false);
    expect(second.gameOver).toBe(first.gameOver);
    expect(second.heightKm).toBeCloseTo(first.heightKm, 10);
    expect(second.board[0]!.position.x).toBeCloseTo(first.board[0]!.position.x, 10);
    expect(second.board[0]!.position.y).toBeCloseTo(first.board[0]!.position.y, 10);
    expect(second.board[0]!.angle).toBeCloseTo(first.board[0]!.angle, 10);
    expect(first.board[0]!.velocity).toEqual({ x: 0, y: 0 });
    expect(first.board[0]!.angularVelocity).toBe(0);
    expect(first.board[0]!.isSleeping).toBe(true);
  });

  it('removes residual velocity when restoring a completed-turn board', () => {
    const game = new PrefectureTowerGame(data, 77);
    game.loadBoard([{ ...piece(0), velocity: { x: 8, y: 12 }, angularVelocity: 2, isSleeping: false }]);

    const [restored] = game.serializeBoard();
    expect(restored).toMatchObject({
      prefectureCode: piece(0).prefectureCode,
      angle: 0,
      velocity: { x: 0, y: 0 },
      angularVelocity: 0,
      isSleeping: true,
    });
    expect(restored!.position.x).toBe(0);
    expect(restored!.position.y).toBe(0);
  });

  it('starts with a seeded first player and alternates after a safe drop', () => {
    const first = started();
    const second = started();
    expect(first.state.turn).toBe(second.state.turn);
    const turn = first.state.turn!;
    expect(first.requestDrop(turn, 1_500)).toBe(true);
    expect(first.state.dropSequence).toBe(1);
    first.completeDrop([piece(0)], 42, false, 1_600);
    expect(first.state.turn).toBe(turn === 1 ? 2 : 1);
    expect(first.state.score).toBe(1);
    expect(first.requestDrop(first.state.turn!, 1_700)).toBe(true);
    expect(first.state.dropSequence).toBe(2);
  });

  it('rejects non-turn and expired placement input', () => {
    const battle = started();
    const nonTurn = battle.state.turn === 1 ? 2 : 1;
    expect(battle.move(nonTurn, 1, 2_000)).toBe(false);
    expect(battle.rotate(battle.state.turn!, 1, 1_000 + BATTLE_TURN_TIME_MS + 1)).toBe(false);
  });

  it('forces a drop at the server deadline', () => {
    const battle = started();
    expect(battle.expire(1_000 + BATTLE_TURN_TIME_MS - 1)).toBe('none');
    expect(battle.expire(1_000 + BATTLE_TURN_TIME_MS)).toBe('drop');
    expect(battle.state.phase).toBe('dropping');
  });

  it('migrates old rooms whose drop animation id was reset each turn', () => {
    const original = started();
    original.requestDrop(original.state.turn!, 1_100);
    original.completeDrop([piece(0)], 42, false, 1_200);
    const stored = structuredClone(original.state);
    stored.dropSequence = 0;

    const restored = new BattleStateMachine(stored.roomId, stored.seed, data, hints, stored);
    expect(restored.state.dropSequence).toBe(1);
    expect(restored.requestDrop(restored.state.turn!, 1_300)).toBe(true);
    expect(restored.state.dropSequence).toBe(2);
  });

  it('keeps the room in dropping phase for the simulated fall duration', () => {
    const battle = started();
    const turn = battle.state.turn!;
    expect(battle.requestDrop(turn, 1_100)).toBe(true);
    expect(battle.state.phase).toBe('dropping');
    battle.stageDrop(1_000, 1_200);
    expect(battle.state.score).toBe(0);
    expect(battle.expire(2_199)).toBe('none');
    expect(battle.expire(2_200)).toBe('dropResolved');
    battle.completeDrop([piece(0)], 42, false, 2_200);
    expect(battle.state.score).toBe(1);
    expect(battle.state.phase).toBe('placing');
    expect(battle.state.turn).toBe(turn === 1 ? 2 : 1);
    expect(battle.state.deadline).toBe(2_200 + BATTLE_TURN_TIME_MS);
  });

  it('does not let the next player act before the server commits the drop result', () => {
    const battle = started();
    const droppingPlayer = battle.state.turn!;
    const nextPlayer = droppingPlayer === 1 ? 2 : 1;
    battle.requestDrop(droppingPlayer, 1_100);
    battle.stageDrop(1_000, 1_200);

    expect(battle.move(nextPlayer, 1, 2_100)).toBe(false);
    expect(battle.requestDrop(nextPlayer, 2_100)).toBe(false);
    expect(battle.expire(2_200)).toBe('dropResolved');
    expect(battle.state.phase).toBe('dropping');
    expect(battle.requestDrop(nextPlayer, 2_200)).toBe(false);

    battle.completeDrop([piece(0)], 42, false, 2_200);
    expect(battle.state.phase).toBe('placing');
    expect(battle.state.turn).toBe(nextPlayer);
    expect(battle.requestDrop(nextPlayer, 2_201)).toBe(true);
  });

  it('starts an attack at 10 and each following 5 prefectures', () => {
    expect([9, 10, 11, 14, 15, 20].filter(shouldStartAttack)).toEqual([10, 15, 20]);
    const battle = started();
    const turn = battle.state.turn!;
    battle.requestDrop(turn, 1_100);
    battle.completeDrop(Array.from({ length: 10 }, (_, index) => piece(index)), 200, false, 1_200);
    expect(battle.state.phase).toBe('prefectureAttack');
    expect(battle.state.attackPlayer).toBe(turn);
    expect(battle.state.attackCards).toHaveLength(4);
    for (const card of battle.state.attackCards) {
      expect(card.hints).toHaveLength(1);
      const matches = hints.filter((entry) => card.hints.every((text) => entry.facts.some((fact) => fact.text === text)));
      expect(matches.map((entry) => entry.prefectureCode)).toEqual([card.prefectureCode]);
    }
  });

  it('reveals a selected attack answer for half a second before applying it', () => {
    const battle = started();
    const turn = battle.state.turn!;
    battle.requestDrop(turn, 1_100);
    battle.completeDrop(Array.from({ length: 10 }, (_, index) => piece(index)), 200, false, 1_200);
    const card = battle.state.attackCards[0]!;
    const currentBeforeReveal = battle.state.currentPrefectureCode;
    expect(battle.selectAttack(turn, card.id, 1_300)).toBe(true);
    expect(battle.state.phase).toBe('prefectureAttackReveal');
    expect(battle.state.revealedAttackCardId).toBe(card.id);
    expect(battle.state.deadline).toBe(1_300 + BATTLE_ATTACK_REVEAL_MS);
    expect(battle.state.currentPrefectureCode).toBe(currentBeforeReveal);
    expect(battle.expire(1_300 + BATTLE_ATTACK_REVEAL_MS - 1)).toBe('none');
    expect(battle.expire(1_300 + BATTLE_ATTACK_REVEAL_MS)).toBe('attackResolved');
    expect(battle.state.currentPrefectureCode).toBe(card.prefectureCode);
    expect(battle.state.turn).toBe(turn === 1 ? 2 : 1);
    expect(battle.state.revealedAttackCardId).toBeNull();
  });

  it('reveals a deterministic attack card on timeout before the next turn', () => {
    const first = started(44);
    const second = started(44);
    for (const battle of [first, second]) {
      const turn = battle.state.turn!;
      battle.requestDrop(turn, 1_100);
      battle.completeDrop(Array.from({ length: 10 }, (_, index) => piece(index)), 200, false, 1_200);
      const selectionDeadline = battle.state.deadline!;
      expect(battle.expire(selectionDeadline)).toBe('attackRevealed');
      expect(battle.state.phase).toBe('prefectureAttackReveal');
      expect(battle.state.revealedAttackCardId).not.toBeNull();
    }
    expect(first.state.revealedAttackCardId).toBe(second.state.revealedAttackCardId);
    const firstAnswer = first.state.forcedPrefectureCode;
    expect(firstAnswer).toBe(second.state.forcedPrefectureCode);
    for (const battle of [first, second]) battle.expire(battle.state.deadline!);
    expect(first.state.currentPrefectureCode).toBe(firstAnswer);
    expect(second.state.currentPrefectureCode).toBe(firstAnswer);
  });

  it('makes the player who caused game over the loser', () => {
    const battle = started();
    const turn = battle.state.turn!;
    battle.requestDrop(turn, 1_100);
    battle.completeDrop([piece(0)], 10, true, 1_200);
    expect(battle.state.loser).toBe(turn);
    expect(battle.state.winner).toBe(turn === 1 ? 2 : 1);
  });

  it('starts a fresh match in the same room after both players request a rematch', () => {
    const battle = started();
    expect(battle.requestRematch(1, 1_050)).toBe(false);
    const turn = battle.state.turn!;
    battle.requestDrop(turn, 1_100);
    battle.completeDrop([piece(0)], 10, true, 1_200);
    const previousSeed = battle.state.seed;
    const previousDropSequence = battle.state.dropSequence;

    expect(battle.requestRematch(1, 1_300)).toBe(true);
    expect(battle.state.phase).toBe('gameOver');
    expect(battle.state.rematchReady).toEqual([1]);
    expect(battle.requestRematch(1, 1_350)).toBe(true);
    expect(battle.state.rematchReady).toEqual([1]);

    expect(battle.requestRematch(2, 1_400)).toBe(true);
    expect(battle.state.roomId).toBe('ABC234');
    expect(battle.state.phase).toBe('placing');
    expect(battle.state.matchNumber).toBe(2);
    expect(battle.state.seed).not.toBe(previousSeed);
    expect(battle.state.score).toBe(0);
    expect(battle.state.heightKm).toBe(0);
    expect(battle.state.board).toEqual([]);
    expect(battle.state.winner).toBeNull();
    expect(battle.state.loser).toBeNull();
    expect(battle.state.rematchReady).toEqual([]);
    expect(battle.state.dropSequence).toBe(previousDropSequence);
    expect(battle.state.currentPrefectureCode).not.toBeNull();
    expect(battle.state.nextPrefectureCode).not.toBeNull();
  });

  it('restores a disconnected player with the same token', () => {
    const battle = started();
    battle.disconnect(1, 2_000);
    expect(battle.state.players[0]!.connected).toBe(false);
    expect(battle.addPlayer('one', 2_100)?.number).toBe(1);
    expect(battle.state.players[0]!.connected).toBe(true);
  });
});
