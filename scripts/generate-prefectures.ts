import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';
import decomp from 'poly-decomp';
import proj4 from 'proj4';
import { PREFECTURES, PROJECTION, REGION_COLORS, SOURCE_REVISION } from '../src/constants';
import type {
  CollisionPart,
  PrefectureAsset,
  PrefectureAssetCollection,
  RenderRing,
  SourceReference,
  Vec2,
} from '../src/types';
import { area, boundsOf, centroid, roundPoint, simplifyVisvalingam } from './lib/geometry';

type Position = [number, number];
type PolygonGeometry = { type: 'Polygon'; coordinates: Position[][] };
type MultiPolygonGeometry = { type: 'MultiPolygon'; coordinates: Position[][][] };
type GeoJson =
  | { type: 'FeatureCollection'; features: Array<{ geometry: PolygonGeometry | MultiPolygonGeometry | null }> }
  | { type: 'GeometryCollection'; geometries: Array<PolygonGeometry | MultiPolygonGeometry> }
  | PolygonGeometry
  | MultiPolygonGeometry;
type SourceComponent = { lonLat: Position[]; projected: Vec2[]; centerLonLat: Position; sourceAreaKm2: number };
type SelectedComponent = SourceComponent & { id: string; label: string; kind: 'main' | 'island' };

const run = promisify(execFile);
const root = path.resolve(import.meta.dirname, '..');
const cacheDir = path.join(root, '.cache', 'prefectures');
const rawDir = path.join(cacheDir, 'raw');
const dissolvedDir = path.join(cacheDir, 'dissolved');
const assetPath = path.join(root, 'public', 'assets', 'prefectures.json');
const mapshaperBin = path.join(root, 'node_modules', 'mapshaper', 'bin', 'mapshaper');
const sourceBase = `https://raw.githubusercontent.com/ricewin/simplify-japan-geojson/${SOURCE_REVISION}/GeoJson`;
// proj4js requires explicit false easting/northing for LAEA; divide its metre output to honour the km contract.
const projectionInMeters = `${PROJECTION.replace('+units=km', '+units=m')} +x_0=0 +y_0=0`;
const gsiDate = '2026-04-01';
const gsiZoom = 16;
const gsiCenterTile = { x: 56773, y: 25453 };

function sha256(buffer: Uint8Array): string {
  return createHash('sha256').update(buffer).digest('hex');
}

async function download(url: string, destination: string): Promise<{ bytes: Uint8Array; hash: string }> {
  try {
    const cached = new Uint8Array(await readFile(destination));
    return { bytes: cached, hash: sha256(cached) };
  } catch {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, bytes);
    return { bytes, hash: sha256(bytes) };
  }
}

function stripClosingPoint(ring: Position[]): Position[] {
  if (ring.length > 1 && ring[0]![0] === ring.at(-1)?.[0] && ring[0]![1] === ring.at(-1)?.[1]) return ring.slice(0, -1);
  return ring;
}

function projectRing(ring: Position[]): Vec2[] {
  return stripClosingPoint(ring).map(([longitude, latitude]) => {
    const [x, y] = proj4('EPSG:4326', projectionInMeters, [longitude, latitude]);
    return { x: x / 1000, y: -y / 1000 };
  });
}

function lonLatCenter(ring: Position[]): Position {
  const unclosed = stripClosingPoint(ring);
  return [
    unclosed.reduce((sum, point) => sum + point[0], 0) / unclosed.length,
    unclosed.reduce((sum, point) => sum + point[1], 0) / unclosed.length,
  ];
}

function extractComponents(geojson: GeoJson): SourceComponent[] {
  const rings: Position[][] = [];
  const geometries = geojson.type === 'FeatureCollection'
    ? geojson.features.map((feature) => feature.geometry).filter((geometry) => geometry !== null)
    : geojson.type === 'GeometryCollection' ? geojson.geometries : [geojson];
  for (const geometry of geometries) {
    if (geometry.type === 'Polygon') rings.push(geometry.coordinates[0]!);
    else rings.push(...geometry.coordinates.map((polygon) => polygon[0]!));
  }
  return rings
    .map((lonLat) => {
      const projected = projectRing(lonLat);
      return { lonLat, projected, centerLonLat: lonLatCenter(lonLat), sourceAreaKm2: area(projected) };
    })
    .filter((component) => component.projected.length >= 3 && component.sourceAreaKm2 > 1e-7)
    .sort((a, b) => b.sourceAreaKm2 - a.sourceAreaKm2);
}

function inside(center: Position, west: number, south: number, east: number, north: number): boolean {
  return center[0] >= west && center[0] <= east && center[1] >= south && center[1] <= north;
}

function selectComponents(code: string, components: SourceComponent[]): SelectedComponent[] {
  if (!components[0]) throw new Error(`Prefecture ${code} contains no polygon components.`);
  const main = { ...components[0], id: 'main', label: '本体', kind: 'main' as const };
  let islands: SourceComponent[] = [];
  let prefix = 'island';
  let label = '保持島';

  if (code === '13' || code === '47') {
    islands = components.slice(1);
    prefix = code === '13' ? 'tokyo-island' : 'okinawa-island';
    label = code === '13' ? '東京都の島' : '沖縄県の島';
  } else if (code === '01') {
    islands = components.slice(1).filter((component) => component.centerLonLat[0] >= 145.2);
    prefix = 'northern-territory';
    label = '北方領土';
  } else if (code === '15') {
    islands = components.slice(1).filter((component) => inside(component.centerLonLat, 137.7, 37.7, 138.7, 38.5)).slice(0, 1);
    prefix = 'sado';
    label = '佐渡島';
  } else if (code === '28') {
    islands = components.slice(1).filter((component) => inside(component.centerLonLat, 133.85, 34.05, 135.05, 34.75)).slice(0, 1);
    prefix = 'awaji';
    label = '淡路島';
  } else if (code === '37') {
    islands = components.slice(1).filter((component) => inside(component.centerLonLat, 134.0, 34.35, 134.55, 34.75)).slice(0, 1);
    prefix = 'shodoshima';
    label = '小豆島';
  }

  return [
    main,
    ...islands.map((component, index) => ({
      ...component,
      id: `${prefix}-${String(index + 1).padStart(2, '0')}`,
      label,
      kind: 'island' as const,
    })),
  ];
}

function pointsMatch(a: Position, b: Position): boolean {
  return Math.abs(a[0] - b[0]) < 5e-7 && Math.abs(a[1] - b[1]) < 5e-7;
}

function stitchLines(input: Position[][]): Position[][] {
  const chains = input.map((line) => [...line]);
  let merged = true;
  while (merged) {
    merged = false;
    for (let first = 0; first < chains.length && !merged; first += 1) {
      if (pointsMatch(chains[first]![0]!, chains[first]!.at(-1)!)) continue;
      for (let second = first + 1; second < chains.length; second += 1) {
        const a = chains[first]!;
        const b = chains[second]!;
        let combined: Position[] | undefined;
        if (pointsMatch(a.at(-1)!, b[0]!)) combined = [...a, ...b.slice(1)];
        else if (pointsMatch(a.at(-1)!, b.at(-1)!)) combined = [...a, ...[...b].reverse().slice(1)];
        else if (pointsMatch(a[0]!, b.at(-1)!)) combined = [...b.slice(0, -1), ...a];
        else if (pointsMatch(a[0]!, b[0]!)) combined = [...[...b].reverse().slice(0, -1), ...a];
        if (!combined) continue;
        chains[first] = combined;
        chains.splice(second, 1);
        merged = true;
        break;
      }
    }
  }
  return chains.filter((chain) => pointsMatch(chain[0]!, chain.at(-1)!));
}

async function loadTakeshima(): Promise<{ components: SourceComponent[]; sources: SourceReference[] }> {
  const coastlines: Position[][] = [];
  const sources: SourceReference[] = [];
  for (let tileY = gsiCenterTile.y - 1; tileY <= gsiCenterTile.y + 1; tileY += 1) {
    for (let tileX = gsiCenterTile.x - 1; tileX <= gsiCenterTile.x + 1; tileX += 1) {
      const url = `https://cyberjapandata.gsi.go.jp/xyz/experimental_bvmap/${gsiZoom}/${tileX}/${tileY}.pbf`;
      const result = await download(url, path.join(cacheDir, 'gsi', `${gsiZoom}-${tileX}-${tileY}.pbf`));
      sources.push({
        label: '国土地理院ベクトルタイル（竹島海岸線）',
        url,
        revision: gsiDate,
        acquiredAt: new Date().toISOString().slice(0, 10),
        sha256: result.hash,
        tile: { z: gsiZoom, x: tileX, y: tileY },
      });
      const tile = new VectorTile(new Pbf(result.bytes));
      const layer = tile.layers.coastline;
      if (!layer) continue;
      for (let index = 0; index < layer.length; index += 1) {
        const geometry = layer.feature(index).toGeoJSON(tileX, tileY, gsiZoom).geometry;
        if (geometry.type === 'LineString') coastlines.push(geometry.coordinates as Position[]);
        if (geometry.type === 'MultiLineString') coastlines.push(...(geometry.coordinates as Position[][]));
      }
    }
  }

  const components = stitchLines(coastlines)
    .filter((ring) => inside(lonLatCenter(ring), 131.84, 37.22, 131.89, 37.27))
    .map((lonLat) => {
      const projected = projectRing(lonLat);
      return { lonLat, projected, centerLonLat: lonLatCenter(lonLat), sourceAreaKm2: area(projected) };
    })
    .filter((component) => component.sourceAreaKm2 > 0.000001)
    .sort((a, b) => b.sourceAreaKm2 - a.sourceAreaKm2);
  if (components.length === 0) throw new Error('GSI coastline extraction produced no Takeshima polygons.');
  return { components, sources };
}

function decompose(ring: RenderRing): CollisionPart[] {
  const polygon = ring.vertices.map((point) => [point.x, point.y] as [number, number]);
  decomp.removeDuplicatePoints(polygon, 1e-7);
  decomp.removeCollinearPoints(polygon, 1e-7);
  if (!decomp.isSimple(polygon)) throw new Error(`${ring.id} is self-intersecting after simplification.`);
  decomp.makeCCW(polygon);
  return decomp.quickDecomp(polygon).map((part) => ({
    ringId: ring.id,
    kind: ring.kind,
    vertices: part.map(([x, y]) => roundPoint({ x, y })),
  }));
}

function buildAsset(
  definition: (typeof PREFECTURES)[number],
  selected: SelectedComponent[],
  source: SourceReference,
  additionalSources: SourceReference[] = [],
): PrefectureAsset {
  const [code, nameJa, nameEn, region] = definition;
  const mainProjectedCenter = centroid(selected[0]!.projected);

  const reducedIslands = new Set<string>();
  const createRings = (): RenderRing[] => selected.map((component) => {
    const shifted = component.projected.map((point) => ({
      x: point.x - mainProjectedCenter.x,
      y: point.y - mainProjectedCenter.y,
    }));
    const min = component.kind === 'main' ? 20 : 6;
    const max = component.kind === 'main' ? 80 : reducedIslands.has(component.id) ? 6 : 24;
    const simplified = simplifyVisvalingam(shifted, min, max);
    const simplifiedArea = area(simplified);
    return {
      id: component.id,
      kind: component.kind,
      label: component.label,
      vertices: simplified.map(roundPoint),
      centroid: roundPoint(centroid(simplified)),
      areaKm2: Number(simplifiedArea.toFixed(6)),
      sourceAreaKm2: Number(component.sourceAreaKm2.toFixed(6)),
      simplificationError: Number((Math.abs(simplifiedArea - component.sourceAreaKm2) / component.sourceAreaKm2).toFixed(6)),
    };
  });

  let renderRings = createRings();
  let collisionParts = renderRings.flatMap(decompose);
  if (collisionParts.length > 256) {
    const smallestFirst = selected
      .filter((component) => component.kind === 'island')
      .sort((a, b) => a.sourceAreaKm2 - b.sourceAreaKm2);
    for (const island of smallestFirst) {
      reducedIslands.add(island.id);
      renderRings = createRings();
      collisionParts = renderRings.flatMap(decompose);
      if (collisionParts.length <= 256) break;
    }
  }
  if (collisionParts.length > 256) throw new Error(`${nameJa} exceeds the 256 collision part limit (${collisionParts.length}).`);

  const retainedAreaKm2 = renderRings.reduce((sum, ring) => sum + ring.areaKm2, 0);
  const weightedCenter = renderRings.reduce(
    (sum, ring) => ({ x: sum.x + ring.centroid.x * ring.areaKm2, y: sum.y + ring.centroid.y * ring.areaKm2 }),
    { x: 0, y: 0 },
  );
  return {
    code,
    nameJa,
    nameEn,
    region,
    color: REGION_COLORS[region],
    retainedAreaKm2: Number(retainedAreaKm2.toFixed(6)),
    mass: 1,
    centerOfMass: roundPoint({ x: weightedCenter.x / retainedAreaKm2, y: weightedCenter.y / retainedAreaKm2 }),
    renderRings,
    collisionParts,
    islandMarkers: renderRings.filter((ring) => ring.kind === 'island').map((ring) => ({
      ringId: ring.id,
      label: ring.label,
      position: ring.centroid,
      areaKm2: ring.areaKm2,
    })),
    bounds: boundsOf(renderRings.map((ring) => ring.vertices)),
    mainBounds: boundsOf([renderRings[0]!.vertices]),
    sources: [source, ...additionalSources],
  };
}

async function dissolve(rawPath: string, outputPath: string): Promise<void> {
  try {
    await readFile(outputPath);
    return;
  } catch {
    await mkdir(path.dirname(outputPath), { recursive: true });
  }
  await run(process.execPath, [mapshaperBin, rawPath, '-dissolve', '-clean', '-o', outputPath, 'format=geojson', 'force'], {
    maxBuffer: 20 * 1024 * 1024,
  });
}

async function main(): Promise<void> {
  await mkdir(path.dirname(assetPath), { recursive: true });
  const assets: PrefectureAsset[] = [];
  const sourceManifest: SourceReference[] = [];
  const takeshima = await loadTakeshima();

  for (const definition of PREFECTURES) {
    const [code] = definition;
    const url = `${sourceBase}/${code}.json`;
    const rawPath = path.join(rawDir, `${code}.json`);
    const outputPath = path.join(dissolvedDir, `${code}.json`);
    const raw = await download(url, rawPath);
    const source: SourceReference = {
      label: 'simplify-japan-geojson（都道府県内を結合）',
      url,
      revision: SOURCE_REVISION,
      sha256: raw.hash,
      acquiredAt: new Date().toISOString().slice(0, 10),
    };
    sourceManifest.push(source);
    await dissolve(rawPath, outputPath);
    const geojson = JSON.parse(await readFile(outputPath, 'utf8')) as GeoJson;
    let selected = selectComponents(code, extractComponents(geojson));
    let extras: SourceReference[] = [];
    if (code === '32') {
      selected = [
        ...selected,
        ...takeshima.components.map((component, index) => ({
          ...component,
          id: `takeshima-${String(index + 1).padStart(2, '0')}`,
          label: '竹島',
          kind: 'island' as const,
        })),
      ];
      extras = takeshima.sources;
    }
    assets.push(buildAsset(definition, selected, source, extras));
    process.stdout.write(`${code} `);
  }

  sourceManifest.push(...takeshima.sources);
  const areas = assets.map((asset) => asset.retainedAreaKm2).sort((a, b) => a - b);
  const medianAreaKm2 = areas[Math.floor(areas.length / 2)]!;
  for (const asset of assets) asset.mass = Number(Math.min(asset.retainedAreaKm2 / medianAreaKm2, 8).toFixed(6));

  const collection: PrefectureAssetCollection = {
    schemaVersion: 1,
    projection: PROJECTION,
    generatedAt: new Date().toISOString(),
    sourceRevision: SOURCE_REVISION,
    sourceManifest,
    medianAreaKm2,
    assets,
  };
  await writeFile(assetPath, `${JSON.stringify(collection)}\n`, 'utf8');
  process.stdout.write(`\nGenerated ${assets.length} prefectures at ${assetPath}\n`);
}

await main();
