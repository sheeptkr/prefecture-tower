import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { PREFECTURES, PROJECTION, SOURCE_REVISION } from '../src/constants';
import type { PrefectureAssetCollection, Vec2 } from '../src/types';
import { area, isConvex, isSimple, signedArea } from './lib/geometry';

const assetPath = path.resolve(import.meta.dirname, '..', 'public', 'assets', 'prefectures.json');
const collection = JSON.parse(await readFile(assetPath, 'utf8')) as PrefectureAssetCollection;
const failures: string[] = [];

function check(condition: unknown, message: string): asserts condition {
  if (!condition) failures.push(message);
}

function finitePoint(point: Vec2): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

check(collection.schemaVersion === 1, 'schemaVersion must be 1');
check(collection.projection === PROJECTION, 'projection contract changed');
check(collection.sourceRevision === SOURCE_REVISION, 'source revision is not pinned');
check(collection.assets.length === 47, `expected 47 assets, received ${collection.assets.length}`);
check(new Set(collection.assets.map((asset) => asset.code)).size === 47, 'prefecture codes are duplicated');

const expectedCodes = PREFECTURES.map(([code]) => code);
check(collection.assets.every((asset, index) => asset.code === expectedCodes[index]), 'JIS codes must be ordered 01 through 47');

const specialIslandCodes = new Set(['01', '13', '15', '28', '32', '37', '47']);
for (const asset of collection.assets) {
  const main = asset.renderRings.filter((ring) => ring.kind === 'main');
  const islands = asset.renderRings.filter((ring) => ring.kind === 'island');
  check(main.length === 1 && main[0]?.id === 'main', `${asset.code}: exactly one main ring is required`);
  check(main[0] && main[0].vertices.length >= 20 && main[0].vertices.length <= 80, `${asset.code}: main vertex budget violated`);
  check(asset.collisionParts.length > 0 && asset.collisionParts.length <= 256, `${asset.code}: collision part budget violated`);
  check(asset.retainedAreaKm2 > 0 && asset.mass > 0 && asset.mass <= 8, `${asset.code}: invalid area or mass`);
  check(finitePoint(asset.centerOfMass), `${asset.code}: invalid center of mass`);
  check(asset.bounds.width > 0 && asset.bounds.height > 0, `${asset.code}: invalid bounds`);
  check(asset.mainBounds.width > 0 && asset.mainBounds.height > 0, `${asset.code}: invalid main bounds`);
  check(specialIslandCodes.has(asset.code) ? islands.length > 0 : islands.length === 0, `${asset.code}: island retention rule violated`);

  for (const ring of asset.renderRings) {
    const limits = ring.kind === 'main' ? [20, 80] : [6, 24];
    check(ring.vertices.length >= limits[0]! && ring.vertices.length <= limits[1]!, `${asset.code}/${ring.id}: vertex budget violated`);
    check(ring.vertices.every(finitePoint), `${asset.code}/${ring.id}: contains NaN or Infinity`);
    check(isSimple(ring.vertices), `${asset.code}/${ring.id}: render ring self-intersects`);
    check(area(ring.vertices) > 0, `${asset.code}/${ring.id}: zero-area render ring`);
    const budgetLimited = ring.vertices.length === limits[1] || ring.vertices.length === limits[0];
    check(ring.simplificationError <= 0.02001 || budgetLimited, `${asset.code}/${ring.id}: area error exceeds 2% without hitting a vertex limit`);
  }

  for (const part of asset.collisionParts) {
    check(part.vertices.length >= 3, `${asset.code}/${part.ringId}: collision part has fewer than three vertices`);
    check(part.vertices.every(finitePoint), `${asset.code}/${part.ringId}: collision part contains NaN or Infinity`);
    check(isSimple(part.vertices), `${asset.code}/${part.ringId}: collision part self-intersects`);
    check(isConvex(part.vertices), `${asset.code}/${part.ringId}: collision part is concave`);
    check(signedArea(part.vertices) > 0, `${asset.code}/${part.ringId}: collision part winding is not counter-clockwise`);
  }

  const expectedMass = Math.min(asset.retainedAreaKm2 / collection.medianAreaKm2, 8);
  check(Math.abs(asset.mass - expectedMass) < 1e-5, `${asset.code}: mass does not match retained-area ratio`);
}

function requireRing(code: string, prefix: string): void {
  const asset = collection.assets.find((candidate) => candidate.code === code);
  check(asset?.renderRings.some((ring) => ring.id.startsWith(prefix)), `${code}: missing required ${prefix} geometry`);
}

requireRing('01', 'northern-territory');
requireRing('13', 'tokyo-island');
requireRing('15', 'sado');
requireRing('28', 'awaji');
requireRing('32', 'takeshima');
requireRing('37', 'shodoshima');
requireRing('47', 'okinawa-island');

const takeshimaSources = collection.sourceManifest.filter((source) => source.label.includes('竹島海岸線'));
check(takeshimaSources.length === 9, `expected 9 GSI tiles, received ${takeshimaSources.length}`);
check(takeshimaSources.every((source) => source.revision === '2026-04-01' && source.tile && /^[a-f0-9]{64}$/.test(source.sha256 ?? '')), 'GSI manifest is incomplete');

if (failures.length > 0) {
  console.error(failures.map((failure) => `- ${failure}`).join('\n'));
  process.exitCode = 1;
} else {
  console.log(`Validated ${collection.assets.length} prefectures, ${collection.assets.reduce((sum, asset) => sum + asset.renderRings.length, 0)} rings, and ${collection.assets.reduce((sum, asset) => sum + asset.collisionParts.length, 0)} convex parts.`);
}
