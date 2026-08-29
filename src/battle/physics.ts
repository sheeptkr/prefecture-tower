import { PrefectureTowerGame } from '../game';
import { BATTLE_PLATFORM_WIDTH_SCALE } from '../constants';
import type { PrefectureAssetCollection, SerializedPiece } from '../types';

export type DropResult = {
  board: SerializedPiece[];
  heightKm: number;
  gameOver: boolean;
  durationMs: number;
};

export function resolveAuthoritativeDrop(
  data: PrefectureAssetCollection,
  seed: number,
  board: SerializedPiece[],
  prefectureCode: string,
  placement: { x: number; angle: number },
): DropResult {
  const asset = data.assets.find((candidate) => candidate.code === prefectureCode);
  if (!asset) throw new Error(`Unknown prefecture code: ${prefectureCode}`);
  const game = new PrefectureTowerGame(data, seed, { platformWidthScale: BATTLE_PLATFORM_WIDTH_SCALE });
  game.loadBoard(board);
  game.prepareAsset(asset, placement.x, placement.angle);
  const durationMs = game.resolveDrop();
  const serialized = game.serializeBoard();
  return {
    board: serialized,
    heightKm: game.phase === 'gameOver' ? game.measureHeight() : game.heightKm,
    gameOver: game.phase === 'gameOver',
    durationMs,
  };
}
