import { piecePoint, placementPoint } from './game';
import type { PrefectureTowerGame } from './game';
import type { Bounds, PrefectureAsset, RenderRing, Vec2 } from './types';

type Camera = { x: number; y: number; scale: number };
type ScreenPoint = { x: number; y: number };

function includePoint(bounds: Bounds, point: Vec2): void {
  bounds.min.x = Math.min(bounds.min.x, point.x);
  bounds.min.y = Math.min(bounds.min.y, point.y);
  bounds.max.x = Math.max(bounds.max.x, point.x);
  bounds.max.y = Math.max(bounds.max.y, point.y);
  bounds.width = bounds.max.x - bounds.min.x;
  bounds.height = bounds.max.y - bounds.min.y;
}

function emptyBounds(): Bounds {
  return {
    min: { x: Number.POSITIVE_INFINITY, y: Number.POSITIVE_INFINITY },
    max: { x: Number.NEGATIVE_INFINITY, y: Number.NEGATIVE_INFINITY },
    width: 0,
    height: 0,
  };
}

export class GameRenderer {
  private readonly context: CanvasRenderingContext2D;
  private camera: Camera = { x: 0, y: 0, scale: 1 };
  private width = 1;
  private height = 1;
  private pixelRatio = 1;

  constructor(private readonly canvas: HTMLCanvasElement, private readonly game: PrefectureTowerGame) {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D is not supported by this browser.');
    this.context = context;
    this.resize();
  }

  resize(): void {
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.floor(this.width * this.pixelRatio);
    this.canvas.height = Math.floor(this.height * this.pixelRatio);
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
  }

  private screen(point: Vec2): ScreenPoint {
    return {
      x: (point.x - this.camera.x) * this.camera.scale + this.width / 2,
      y: (point.y - this.camera.y) * this.camera.scale + this.height / 2,
    };
  }

  private visibleBounds(): Bounds {
    const bounds = emptyBounds();
    includePoint(bounds, { x: -this.game.platformWidth / 2, y: 0 });
    includePoint(bounds, { x: this.game.platformWidth / 2, y: this.game.platformThickness });

    if (this.game.phase === 'placing') {
      for (const ring of this.game.placement.asset.renderRings) {
        for (const vertex of ring.vertices) includePoint(bounds, placementPoint(this.game.placement, vertex));
      }
    } else {
      for (const piece of [...this.game.placed, ...(this.game.activePiece ? [this.game.activePiece] : [])]) {
        const main = piece.asset.renderRings.find((ring) => ring.kind === 'main')!;
        for (const vertex of main.vertices) includePoint(bounds, piecePoint(piece, vertex));
      }
    }
    return bounds;
  }

  private updateCamera(): void {
    const bounds = this.visibleBounds();
    const horizontalPadding = Math.min(64, this.width * 0.12);
    const topPadding = this.width < 600 ? 138 : 104;
    const bottomPadding = this.width < 600 ? 180 : 90;
    const availableWidth = Math.max(100, this.width - horizontalPadding * 2);
    const availableHeight = Math.max(100, this.height - topPadding - bottomPadding);
    const paddedWidth = Math.max(bounds.width * 1.12, 1);
    const paddedHeight = Math.max(bounds.height * 1.16, 1);
    const targetScale = Math.min(3.2, availableWidth / paddedWidth, availableHeight / paddedHeight);
    const target = {
      x: (bounds.min.x + bounds.max.x) / 2,
      y: (bounds.min.y + bounds.max.y) / 2 + (bottomPadding - topPadding) / (2 * targetScale),
      scale: targetScale,
    };
    const easing = this.game.phase === 'placing' ? 0.16 : 0.08;
    this.camera.x += (target.x - this.camera.x) * easing;
    this.camera.y += (target.y - this.camera.y) * easing;
    this.camera.scale += (target.scale - this.camera.scale) * easing;
  }

  private drawBackground(): void {
    const context = this.context;
    const gradient = context.createLinearGradient(0, 0, 0, this.height);
    gradient.addColorStop(0, '#0d1b2c');
    gradient.addColorStop(0.56, '#172c43');
    gradient.addColorStop(1, '#22394e');
    context.fillStyle = gradient;
    context.fillRect(0, 0, this.width, this.height);

    context.save();
    context.globalAlpha = 0.13;
    context.strokeStyle = '#bfe8ff';
    context.lineWidth = 1;
    const gridStep = Math.max(44, this.camera.scale * 100);
    const origin = this.screen({ x: 0, y: 0 });
    for (let x = origin.x % gridStep; x < this.width; x += gridStep) {
      context.beginPath(); context.moveTo(x, 0); context.lineTo(x, this.height); context.stroke();
    }
    for (let y = origin.y % gridStep; y < this.height; y += gridStep) {
      context.beginPath(); context.moveTo(0, y); context.lineTo(this.width, y); context.stroke();
    }
    context.restore();
  }

  private drawPlatform(): void {
    const context = this.context;
    const left = this.screen({ x: -this.game.platformWidth / 2, y: 0 });
    const right = this.screen({ x: this.game.platformWidth / 2, y: this.game.platformThickness });
    const width = right.x - left.x;
    const height = Math.max(8, right.y - left.y);
    context.save();
    context.shadowColor = 'rgba(0,0,0,.4)';
    context.shadowBlur = 18;
    context.fillStyle = '#7b91a6';
    context.fillRect(left.x, left.y, width, height);
    context.shadowBlur = 0;
    context.fillStyle = '#dcecff';
    context.fillRect(left.x, left.y, width, Math.max(3, height * 0.12));
    context.restore();

    const deathY = this.screen({ x: 0, y: this.game.deathLineY }).y;
    if (deathY > 0 && deathY < this.height) {
      context.save();
      context.setLineDash([8, 8]);
      context.strokeStyle = 'rgba(255, 105, 105, .65)';
      context.lineWidth = 2;
      context.beginPath(); context.moveTo(0, deathY); context.lineTo(this.width, deathY); context.stroke();
      context.restore();
    }
  }

  private traceRing(ring: RenderRing, transform: (point: Vec2) => Vec2): void {
    const context = this.context;
    ring.vertices.forEach((vertex, index) => {
      const point = this.screen(transform(vertex));
      if (index === 0) context.moveTo(point.x, point.y);
      else context.lineTo(point.x, point.y);
    });
    context.closePath();
  }

  private drawAsset(asset: PrefectureAsset, transform: (point: Vec2) => Vec2, opacity = 1): void {
    const context = this.context;
    context.save();
    context.globalAlpha = opacity;
    context.fillStyle = asset.color;
    context.strokeStyle = '#f7fbff';
    context.lineJoin = 'round';
    context.lineWidth = Math.max(1.5, Math.min(3, this.camera.scale * 1.5));
    context.beginPath();
    for (const ring of asset.renderRings) this.traceRing(ring, transform);
    context.fill();
    context.stroke();

    const main = asset.renderRings.find((ring) => ring.kind === 'main')!;
    const namePosition = this.screen(transform(main.centroid));
    const projectedSize = Math.min(asset.mainBounds.width, asset.mainBounds.height) * this.camera.scale;
    const fontSize = Math.max(10, Math.min(24, projectedSize * 0.18));
    context.font = `800 ${fontSize}px system-ui, sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.lineWidth = Math.max(2, fontSize * 0.24);
    context.strokeStyle = 'rgba(8, 21, 35, .78)';
    context.strokeText(asset.nameJa, namePosition.x, namePosition.y);
    context.fillStyle = '#ffffff';
    context.fillText(asset.nameJa, namePosition.x, namePosition.y);
    this.drawTinyMarkers(asset, transform);
    context.restore();
  }

  private drawTinyMarkers(asset: PrefectureAsset, transform: (point: Vec2) => Vec2): void {
    const context = this.context;
    for (const marker of asset.islandMarkers) {
      const ring = asset.renderRings.find((candidate) => candidate.id === marker.ringId);
      if (!ring) continue;
      const xs = ring.vertices.map((vertex) => transform(vertex).x);
      const ys = ring.vertices.map((vertex) => transform(vertex).y);
      const pixelSize = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) * this.camera.scale;
      if (pixelSize >= 1) continue;
      const point = this.screen(transform(marker.position));
      context.beginPath();
      context.arc(point.x, point.y, 5, 0, Math.PI * 2);
      context.strokeStyle = '#ffffff';
      context.lineWidth = 1.5;
      context.stroke();
      context.beginPath();
      context.arc(point.x, point.y, 1.5, 0, Math.PI * 2);
      context.fillStyle = asset.color;
      context.fill();
    }
  }

  private drawOffscreenIndicators(): void {
    if (this.game.phase === 'placing') return;
    const candidates: Array<{ label: string; point: ScreenPoint; distance: number; color: string }> = [];
    const pieces = [...this.game.placed, ...(this.game.activePiece ? [this.game.activePiece] : [])];
    const used = new Set<string>();
    for (const piece of [...pieces].reverse()) {
      const main = piecePoint(piece, { x: 0, y: 0 });
      for (const marker of piece.asset.islandMarkers) {
        if (used.has(marker.label)) continue;
        const world = piecePoint(piece, marker.position);
        const screen = this.screen(world);
        if (screen.x >= 16 && screen.x <= this.width - 16 && screen.y >= 90 && screen.y <= this.height - 130) continue;
        used.add(marker.label);
        candidates.push({
          label: marker.label,
          point: { x: Math.min(this.width - 38, Math.max(38, screen.x)), y: Math.min(this.height - 142, Math.max(110, screen.y)) },
          distance: Math.hypot(world.x - main.x, world.y - main.y),
          color: piece.asset.color,
        });
        if (candidates.length >= 4) break;
      }
      if (candidates.length >= 4) break;
    }

    const context = this.context;
    for (const indicator of candidates) {
      context.save();
      context.fillStyle = 'rgba(9, 21, 34, .86)';
      context.strokeStyle = indicator.color;
      context.lineWidth = 2;
      context.beginPath(); context.arc(indicator.point.x, indicator.point.y, 27, 0, Math.PI * 2); context.fill(); context.stroke();
      context.fillStyle = '#ffffff';
      context.textAlign = 'center';
      context.font = '700 9px system-ui, sans-serif';
      context.fillText(indicator.label.slice(0, 5), indicator.point.x, indicator.point.y - 3);
      context.font = '8px system-ui, sans-serif';
      context.fillText(`${Math.round(indicator.distance)} km`, indicator.point.x, indicator.point.y + 9);
      context.restore();
    }
  }

  render(): void {
    this.context.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
    this.updateCamera();
    this.drawBackground();
    this.drawPlatform();
    for (const piece of this.game.placed) this.drawAsset(piece.asset, (point) => piecePoint(piece, point));
    if (this.game.activePiece) this.drawAsset(this.game.activePiece.asset, (point) => piecePoint(this.game.activePiece!, point));
    if (this.game.phase === 'placing') {
      this.drawAsset(this.game.placement.asset, (point) => placementPoint(this.game.placement, point), 0.84);
    }
    this.drawOffscreenIndicators();
  }
}
