import Matter from 'matter-js';
import { loadRecords, saveRecords } from './storage';
import { SeededRandom } from './random';
import type { GamePhase, GameSnapshot, PrefectureAsset, PrefectureAssetCollection, Vec2 } from './types';

const { Bodies, Body, Composite, Engine, Sleeping } = Matter;
const fixedStepMs = 1000 / 60;
const settleDurationMs = 350;
const dropTimeoutMs = 5_000;
const linearSleepThreshold = 0.45;
const angularSleepThreshold = 0.03;
const maximumUpwardContactSpeed = 0.35;
const supportBalanceToleranceKm = 0.75;
const settledBodySleepThreshold = 60;
const maximumMainLandOverhangRatio = 0.5;

export type Piece = {
  asset: PrefectureAsset;
  body: Matter.Body;
  frameCenter: Vec2;
};

export type Placement = {
  asset: PrefectureAsset;
  anchor: Vec2;
  angle: number;
};

function polygonCentroid(vertices: Vec2[]): Vec2 {
  let doubleArea = 0;
  let x = 0;
  let y = 0;
  for (let index = 0; index < vertices.length; index += 1) {
    const current = vertices[index]!;
    const next = vertices[(index + 1) % vertices.length]!;
    const cross = current.x * next.y - next.x * current.y;
    doubleArea += cross;
    x += (current.x + next.x) * cross;
    y += (current.y + next.y) * cross;
  }
  return Math.abs(doubleArea) < 1e-8 ? vertices[0]! : { x: x / (3 * doubleArea), y: y / (3 * doubleArea) };
}

function setCompoundMassAndInertia(body: Matter.Body, targetMass: number): void {
  const childParts = body.parts.slice(1);
  const correctedInertia = childParts.reduce((sum, part) => {
    const offsetX = part.position.x - body.position.x;
    const offsetY = part.position.y - body.position.y;
    return sum + part.inertia + part.mass * (offsetX ** 2 + offsetY ** 2);
  }, 0);
  Body.setInertia(body, correctedInertia);
  Body.setMass(body, targetMass);
}

export function rotate(point: Vec2, angle: number): Vec2 {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return { x: point.x * cosine - point.y * sine, y: point.x * sine + point.y * cosine };
}

export function piecePoint(piece: Piece, localPoint: Vec2): Vec2 {
  const offset = rotate({ x: localPoint.x - piece.frameCenter.x, y: localPoint.y - piece.frameCenter.y }, piece.body.angle);
  return { x: piece.body.position.x + offset.x, y: piece.body.position.y + offset.y };
}

export function placementPoint(placement: Placement, localPoint: Vec2): Vec2 {
  const offset = rotate(localPoint, placement.angle);
  return { x: placement.anchor.x + offset.x, y: placement.anchor.y + offset.y };
}

export function createPiece(asset: PrefectureAsset, anchor: Vec2, angle: number): Piece {
  const options: Matter.IBodyDefinition = {
    restitution: 0,
    friction: 0.3,
    frictionStatic: 0.5,
    frictionAir: 0.06,
    slop: 0.02,
    sleepThreshold: Number.POSITIVE_INFINITY,
  };
  const parts = asset.collisionParts.map((part) => {
    const center = polygonCentroid(part.vertices);
    return Bodies.fromVertices(center.x, center.y, [part.vertices], options, false);
  });
  const body = Body.create({ ...options, parts });
  const frameCenter = { x: body.position.x, y: body.position.y };
  // Matter.js sums child inertia without the parallel-axis term; add it before applying gameplay mass.
  setCompoundMassAndInertia(body, asset.mass);
  Body.setAngle(body, angle);
  const anchorAfterRotation = {
    x: body.position.x + rotate({ x: -frameCenter.x, y: -frameCenter.y }, angle).x,
    y: body.position.y + rotate({ x: -frameCenter.x, y: -frameCenter.y }, angle).y,
  };
  Body.translate(body, { x: anchor.x - anchorAfterRotation.x, y: anchor.y - anchorAfterRotation.y });
  return { asset, body, frameCenter };
}

export class PrefectureTowerGame {
  readonly engine = Engine.create({ enableSleeping: true, positionIterations: 10, velocityIterations: 8 });
  readonly platformWidth: number;
  readonly platformThickness: number;
  readonly deathLineY: number;
  readonly seed: number;
  readonly placed: Piece[] = [];
  phase: GamePhase = 'placing';
  placement: Placement;
  activePiece: Piece | null = null;
  nextAsset: PrefectureAsset;
  score = 0;
  heightKm = 0;
  records = loadRecords();
  private settleMs = 0;
  private dropElapsedMs = 0;
  private readonly random: SeededRandom;
  private readonly platform: Matter.Body;

  constructor(readonly data: PrefectureAssetCollection, seed: number) {
    this.seed = seed;
    this.random = new SeededRandom(seed);
    this.platformWidth = Math.max(...data.assets.map((asset) => asset.mainBounds.width)) * 1.1;
    this.platformThickness = this.platformWidth * 0.05;
    this.deathLineY = this.platformWidth * 0.9;
    this.engine.gravity.x = 0;
    this.engine.gravity.y = 1;
    this.engine.gravity.scale = 0.0018;
    this.platform = Bodies.rectangle(0, this.platformThickness / 2, this.platformWidth, this.platformThickness, {
      isStatic: true,
      friction: 0.6,
      frictionStatic: 0.7,
      restitution: 0,
    });
    Composite.add(this.engine.world, this.platform);
    const first = this.drawAsset();
    this.nextAsset = this.drawAsset();
    this.placement = { asset: first, anchor: { x: 0, y: 0 }, angle: 0 };
    this.resetPlacement(first);
  }

  get currentAsset(): PrefectureAsset {
    return this.placement.asset;
  }

  get fixedStepMs(): number {
    return fixedStepMs;
  }

  private drawAsset(): PrefectureAsset {
    return this.data.assets[this.random.integer(this.data.assets.length)]!;
  }

  private towerTop(): number {
    let top = 0;
    for (const piece of this.placed) {
      const main = piece.asset.renderRings.find((ring) => ring.kind === 'main')!;
      for (const vertex of main.vertices) top = Math.min(top, piecePoint(piece, vertex).y);
    }
    return top;
  }

  private resetPlacement(asset: PrefectureAsset): void {
    const gap = Math.max(40, this.platformWidth * 0.08);
    const anchorY = this.towerTop() - asset.mainBounds.max.y - gap;
    this.placement = { asset, anchor: { x: 0, y: anchorY }, angle: 0 };
    this.activePiece = null;
    this.phase = 'placing';
    this.settleMs = 0;
    this.dropElapsedMs = 0;
  }

  move(direction: -1 | 1): void {
    if (this.phase !== 'placing') return;
    const step = Math.max(8, this.platformWidth * 0.035);
    const maximumOverhang = this.placement.asset.mainBounds.width * maximumMainLandOverhangRatio;
    const minimum = -this.platformWidth / 2 - this.placement.asset.mainBounds.min.x - maximumOverhang;
    const maximum = this.platformWidth / 2 - this.placement.asset.mainBounds.max.x + maximumOverhang;
    this.placement.anchor.x = Math.min(maximum, Math.max(minimum, this.placement.anchor.x + direction * step));
  }

  turn(direction: -1 | 1): void {
    if (this.phase !== 'placing') return;
    this.placement.angle += direction * Math.PI / 12;
  }

  drop(): void {
    if (this.phase !== 'placing') return;
    const piece = createPiece(this.placement.asset, this.placement.anchor, this.placement.angle);
    this.activePiece = piece;
    Composite.add(this.engine.world, piece.body);
    this.phase = 'falling';
    this.settleMs = 0;
    this.dropElapsedMs = 0;
  }

  update(): void {
    if (this.phase === 'gameOver') return;
    Engine.update(this.engine, fixedStepMs);
    this.limitContactBounce();
    if (this.hasFallenMainLand()) {
      this.phase = 'gameOver';
      this.commitRecords();
      return;
    }
    if (this.phase === 'placing') return;
    const piece = this.activePiece;
    if (!piece) return;
    this.dropElapsedMs += fixedStepMs;

    const hasSupport = this.hasActiveContact(piece);
    const isStable = hasSupport
      && this.hasBalancedSupport(piece)
      && piece.body.speed < linearSleepThreshold
      && Math.abs(piece.body.angularSpeed) < angularSleepThreshold;
    if (isStable) {
      this.phase = 'settling';
      this.settleMs += fixedStepMs;
    } else {
      this.phase = 'falling';
      this.settleMs = 0;
    }

    const hasTimedOut = this.dropElapsedMs >= dropTimeoutMs - 1e-6;
    if (this.settleMs >= settleDurationMs || hasTimedOut) {
      const canSleep = hasSupport
        && piece.body.speed < linearSleepThreshold
        && Math.abs(piece.body.angularSpeed) < angularSleepThreshold;
      this.completeDrop(piece, canSleep);
    }
  }

  private completeDrop(piece: Piece, sleep: boolean): void {
    piece.body.sleepThreshold = settledBodySleepThreshold;
    if (sleep) Sleeping.set(piece.body, true);
    this.placed.push(piece);
    this.activePiece = null;
    this.score += 1;
    this.heightKm = this.measureHeight();
    this.commitRecords();
    const next = this.nextAsset;
    this.nextAsset = this.drawAsset();
    this.resetPlacement(next);
  }

  private hasFallenMainLand(): boolean {
    const pieces = [...this.placed, ...(this.activePiece ? [this.activePiece] : [])];
    return pieces.some((piece) => piecePoint(piece, { x: 0, y: 0 }).y > this.deathLineY);
  }

  private hasActiveContact(piece: Piece): boolean {
    return this.engine.pairs.list.some((pair: Matter.Pair) => {
      if (!pair.isActive) return false;
      const first = pair.bodyA.parent;
      const second = pair.bodyB.parent;
      return (first === piece.body && second !== piece.body) || (second === piece.body && first !== piece.body);
    });
  }

  private hasBalancedSupport(piece: Piece): boolean {
    const supportXs: number[] = [];
    for (const pair of this.engine.pairs.list) {
      if (!pair.isActive) continue;
      const first = pair.bodyA.parent;
      const second = pair.bodyB.parent;
      if (first !== piece.body && second !== piece.body) continue;
      for (const support of pair.collision.supports) {
        if (support) supportXs.push(support.x);
      }
    }
    if (supportXs.length === 0) return false;
    const minimumX = Math.min(...supportXs) - supportBalanceToleranceKm;
    const maximumX = Math.max(...supportXs) + supportBalanceToleranceKm;
    return piece.body.position.x >= minimumX && piece.body.position.x <= maximumX;
  }

  private limitContactBounce(): void {
    const pieces = [...this.placed, ...(this.activePiece ? [this.activePiece] : [])];
    for (const piece of pieces) {
      if (piece.body.isSleeping || piece.body.velocity.y >= -maximumUpwardContactSpeed || !this.hasActiveContact(piece)) continue;
      Body.setVelocity(piece.body, { x: piece.body.velocity.x, y: -maximumUpwardContactSpeed });
    }
  }

  measureHeight(): number {
    let highest = 0;
    for (const piece of this.placed) {
      const main = piece.asset.renderRings.find((ring) => ring.kind === 'main')!;
      const transformed = main.vertices.map((vertex) => piecePoint(piece, vertex));
      if (!transformed.some((vertex) => vertex.y <= 0)) continue;
      highest = Math.max(highest, -Math.min(...transformed.map((vertex) => vertex.y)));
    }
    return Number(highest.toFixed(1));
  }

  private commitRecords(): void {
    this.records.bestScore = Math.max(this.records.bestScore, this.score);
    this.records.bestHeightKm = Math.max(this.records.bestHeightKm, this.heightKm);
    saveRecords(this.records);
  }

  snapshot(): GameSnapshot {
    return {
      phase: this.phase,
      score: this.score,
      heightKm: this.heightKm,
      currentName: this.currentAsset.nameJa,
      nextName: this.nextAsset.nameJa,
      seed: this.seed,
      records: { ...this.records },
    };
  }
}
