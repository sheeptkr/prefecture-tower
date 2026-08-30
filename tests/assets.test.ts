import { readFileSync } from 'node:fs';
import Matter from 'matter-js';
import { describe, expect, it } from 'vitest';
import { createPiece, piecePoint, PrefectureTowerGame } from '../src/game';
import { BATTLE_PLATFORM_WIDTH_SCALE } from '../src/constants';
import type { PrefectureAssetCollection } from '../src/types';

const data = JSON.parse(readFileSync(new URL('../public/assets/prefectures.json', import.meta.url), 'utf8')) as PrefectureAssetCollection;
const hints = JSON.parse(readFileSync(new URL('../public/assets/prefecture-hints.json', import.meta.url), 'utf8')) as {
  records: Array<{ prefectureCode: string; facts: Array<{ id: string; category: string; text: string; difficulty: number }> }>;
};

describe('generated prefecture assets', () => {
  it('has multiple non-name attack hints for all prefectures', () => {
    expect(hints.records.map((entry) => entry.prefectureCode)).toEqual(data.assets.map((asset) => asset.code));
    for (const entry of hints.records) {
      const asset = data.assets.find((candidate) => candidate.code === entry.prefectureCode)!;
      expect(entry.facts.length).toBeGreaterThanOrEqual(4);
      expect(new Set(entry.facts.map((fact) => fact.id)).size).toBe(entry.facts.length);
      expect(entry.facts.every((fact) => fact.text.length > 4 && !fact.text.includes(asset.nameJa))).toBe(true);
      expect(entry.facts.every((fact) => fact.difficulty >= 3)).toBe(true);
    }
  });

  it('keeps every single hint text unique to one prefecture', () => {
    const owners = new Map<string, string[]>();
    for (const entry of hints.records) {
      for (const fact of entry.facts) {
        owners.set(fact.text, [...(owners.get(fact.text) ?? []), entry.prefectureCode]);
      }
    }
    expect([...owners.entries()].filter(([, codes]) => codes.length !== 1)).toEqual([]);
  });

  it('uses difficult local-trivia categories instead of mechanical or textbook hints', () => {
    const categories = new Set(['landmark', 'food', 'festival', 'culture', 'history', 'nature', 'industry', 'ranking']);
    const bannedPhrases = ['地方区分', '保持陸地面積', '外接形状', '同一縮尺', '県庁所在地', '世界遺産', '日本三景', '日本三名園'];
    const facts = hints.records.flatMap((entry) => entry.facts);
    expect(facts.every((fact) => categories.has(fact.category))).toBe(true);
    expect(facts.every((fact) => bannedPhrases.every((phrase) => !fact.text.includes(phrase)))).toBe(true);
    expect(facts.filter((fact) => fact.category === 'ranking')).toHaveLength(11);
  });

  it('contains one asset for every JIS prefecture code', () => {
    expect(data.assets.map((asset) => asset.code)).toEqual(Array.from({ length: 47 }, (_, index) => String(index + 1).padStart(2, '0')));
  });

  it('creates a finite compound rigid body for all 47 prefectures', () => {
    for (const asset of data.assets) {
      const piece = createPiece(asset, { x: 0, y: -300 }, 0);
      expect(piece.body.parts.length).toBeGreaterThan(1);
      expect(piece.body.parts.length - 1).toBe(asset.collisionParts.length);
      expect(Number.isFinite(piece.body.mass)).toBe(true);
      expect(Number.isFinite(piece.body.inertia)).toBe(true);
      expect(Number.isFinite(piece.body.bounds.min.x)).toBe(true);
      expect(Number.isFinite(piece.body.bounds.max.y)).toBe(true);
      expect(piece.frameCenter.x).toBeCloseTo(asset.centerOfMass.x, 3);
      expect(piece.frameCenter.y).toBeCloseTo(asset.centerOfMass.y, 3);
      const childParts = piece.body.parts.slice(1);
      const sourceMass = childParts.reduce((sum, part) => sum + part.mass, 0);
      const correctedSourceInertia = childParts.reduce((sum, part) => {
        const distanceSquared = (part.position.x - piece.body.position.x) ** 2 + (part.position.y - piece.body.position.y) ** 2;
        return sum + part.inertia + part.mass * distanceSquared;
      }, 0);
      expect(piece.body.inertia).toBeCloseTo(correctedSourceInertia * piece.body.mass / sourceMass, 5);
    }
  });

  it('survives a short physics simulation without NaN or abnormal launch', () => {
    const engine = Matter.Engine.create({ positionIterations: 10, velocityIterations: 8 });
    engine.gravity.scale = 0.0018;
    const ground = Matter.Bodies.rectangle(0, 20, 2400, 40, { isStatic: true });
    Matter.Composite.add(engine.world, ground);
    const fiftyAssets = [...data.assets, ...data.assets.slice(0, 3)];
    const pieces = fiftyAssets.map((asset, index) => createPiece(asset, { x: (index % 8) * 250 - 875, y: -700 - Math.floor(index / 8) * 180 }, 0));
    expect(pieces).toHaveLength(50);
    Matter.Composite.add(engine.world, pieces.map((piece) => piece.body));
    for (let frame = 0; frame < 120; frame += 1) Matter.Engine.update(engine, 1000 / 60);
    for (const piece of pieces) {
      expect(Number.isFinite(piece.body.position.x)).toBe(true);
      expect(Number.isFinite(piece.body.position.y)).toBe(true);
      expect(Math.abs(piece.body.speed)).toBeLessThan(100);
    }
  });
});

describe('game rules', () => {
  it('keeps the solo platform width and halves it only for battle mode', () => {
    const solo = new PrefectureTowerGame(data, 1);
    const battle = new PrefectureTowerGame(data, 1, { platformWidthScale: BATTLE_PLATFORM_WIDTH_SCALE });
    expect(BATTLE_PLATFORM_WIDTH_SCALE).toBe(0.5);
    expect(battle.platformWidth).toBeCloseTo(solo.platformWidth / 2, 10);
    expect(battle.platformThickness).toBe(solo.platformThickness);
    expect(battle.deathLineY).toBe(solo.deathLineY);
  });

  it('uses stronger gravity with no rigid-body bounce', () => {
    const game = new PrefectureTowerGame(data, 1);
    const piece = createPiece(data.assets[0]!, { x: 0, y: -300 }, 0);
    expect(game.engine.gravity.scale).toBe(0.0018);
    expect(piece.body.restitution).toBe(0);
    expect(piece.body.parts.every((part) => part.restitution === 0)).toBe(true);
  });

  it('allows half of the main land width to overhang either platform edge while placing', () => {
    const game = new PrefectureTowerGame(data, 1);
    const bounds = game.currentAsset.mainBounds;
    for (let move = 0; move < 100; move += 1) game.move(-1);
    expect(game.placement.anchor.x + bounds.min.x).toBeCloseTo(-game.platformWidth / 2 - bounds.width / 2, 6);
    for (let move = 0; move < 200; move += 1) game.move(1);
    expect(game.placement.anchor.x + bounds.max.x).toBeCloseTo(game.platformWidth / 2 + bounds.width / 2, 6);
  });

  it('limits upward launch speed caused by compound contacts', () => {
    const game = new PrefectureTowerGame(data, 10);
    expect(game.currentAsset.code).toBe('24');
    game.drop();
    const mie = game.activePiece!;
    let touched = false;
    let maximumUpwardSpeed = 0;
    for (let frame = 0; frame < 1200 && game.score === 0 && game.phase !== 'gameOver'; frame += 1) {
      game.update();
      const hasContact = game.engine.pairs.list.some((pair: Matter.Pair) => pair.isActive
        && (pair.bodyA.parent === mie.body || pair.bodyB.parent === mie.body));
      if (hasContact) touched = true;
      if (touched) maximumUpwardSpeed = Math.max(maximumUpwardSpeed, -mie.body.velocity.y);
    }
    expect(touched).toBe(true);
    expect(maximumUpwardSpeed).toBeLessThanOrEqual(0.350001);
  });

  it('scores quickly after the newest piece finds balanced support and stays stable', () => {
    const game = new PrefectureTowerGame(data, 1234);
    game.drop();
    expect(game.activePiece).not.toBeNull();
    const piece = game.activePiece!;
    for (let frame = 0; frame < 180 && game.activePiece; frame += 1) game.update();
    expect(game.score).toBe(1);
    expect(game.phase).toBe('placing');
    expect(piece.body.isSleeping).toBe(true);
    expect(piece.body.sleepThreshold).toBe(60);
  });

  it('does not advance the turn while the active piece has not reached support', () => {
    const game = new PrefectureTowerGame(data, 1);
    game.engine.gravity.scale = 0;
    game.drop();
    for (let frame = 0; frame < 300; frame += 1) game.update();
    expect(game.score).toBe(0);
    expect(game.phase).toBe('falling');
    expect(game.activePiece).not.toBeNull();

    for (let frame = 300; frame < 900; frame += 1) game.update();
    expect(game.score).toBe(0);
    expect(game.phase).toBe('gameOver');
    expect(game.placed).toHaveLength(0);
  });

  it('ends when an already placed main-land anchor crosses the death line', () => {
    const game = new PrefectureTowerGame(data, 55);
    const oldPiece = createPiece(data.assets[12]!, { x: 0, y: game.deathLineY * 2 }, 0);
    game.placed.push(oldPiece);
    game.update();
    expect(game.phase).toBe('gameOver');
  });

  it('keeps simulating placed pieces while the next piece is being positioned', () => {
    const game = new PrefectureTowerGame(data, 99);
    const oldPiece = createPiece(data.assets[10]!, { x: 0, y: -300 }, 0);
    game.placed.push(oldPiece);
    Matter.Composite.add(game.engine.world, oldPiece.body);
    const previousY = oldPiece.body.position.y;
    game.update();
    expect(game.phase).toBe('placing');
    expect(oldPiece.body.position.y).toBeGreaterThan(previousY);
  });

  it('keeps a settled Chiba body motionless during placement', () => {
    const game = new PrefectureTowerGame(data, 15);
    expect(game.currentAsset.code).toBe('12');
    game.drop();
    for (let frame = 0; frame < 1200 && game.score === 0 && game.phase !== 'gameOver'; frame += 1) game.update();
    const chiba = game.placed[0]!;
    const start = { x: chiba.body.position.x, y: chiba.body.position.y, angle: chiba.body.angle };
    for (let frame = 0; frame < 600; frame += 1) game.update();
    expect(chiba.body.isSleeping).toBe(true);
    expect(chiba.body.position.x).toBe(start.x);
    expect(chiba.body.position.y).toBe(start.y);
    expect(chiba.body.angle).toBe(start.angle);
  });

  it('lets Miyazaki topple once and settle without dancing across the platform', () => {
    const game = new PrefectureTowerGame(data, 36);
    expect(game.currentAsset.code).toBe('45');
    game.drop();
    const miyazaki = game.activePiece!;
    let maximumHorizontalTravel = 0;
    for (let frame = 0; frame < 360 && game.score === 0 && game.phase !== 'gameOver'; frame += 1) {
      game.update();
      maximumHorizontalTravel = Math.max(maximumHorizontalTravel, Math.abs(miyazaki.body.position.x));
    }
    expect(game.score).toBe(1);
    expect(Math.abs(miyazaki.body.angle)).toBeGreaterThan(Math.PI / 4);
    expect(maximumHorizontalTravel).toBeLessThan(90);
  });

  it('settles every prefecture after an isolated unrotated drop', () => {
    for (const asset of data.assets) {
      const game = new PrefectureTowerGame(data, 1);
      const gap = Math.max(40, game.platformWidth * 0.08);
      game.placement = {
        asset,
        anchor: { x: 0, y: -asset.mainBounds.max.y - gap },
        angle: 0,
      };
      game.drop();
      for (let frame = 0; frame < 1200 && game.score === 0 && game.phase !== 'gameOver'; frame += 1) game.update();
      expect({ code: asset.code, phase: game.phase, score: game.score }).toEqual({
        code: asset.code,
        phase: 'placing',
        score: 1,
      });
    }
  });

  it('measures height using main land only', () => {
    const game = new PrefectureTowerGame(data, 1);
    const tokyo = data.assets.find((asset) => asset.code === '13')!;
    const piece = createPiece(tokyo, { x: 0, y: -100 }, 0);
    game.placed.push(piece);
    const main = tokyo.renderRings.find((ring) => ring.kind === 'main')!;
    const expected = -Math.min(...main.vertices.map((vertex) => piecePoint(piece, vertex).y));
    expect(game.measureHeight()).toBeCloseTo(expected, 1);
  });
});
