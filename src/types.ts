export type Vec2 = { x: number; y: number };

export type Bounds = {
  min: Vec2;
  max: Vec2;
  width: number;
  height: number;
};

export type RegionId =
  | 'hokkaido'
  | 'tohoku'
  | 'kanto'
  | 'chubu'
  | 'kinki'
  | 'chugoku'
  | 'shikoku'
  | 'kyushu-okinawa';

export type RingKind = 'main' | 'island';

export type RenderRing = {
  id: string;
  kind: RingKind;
  label: string;
  vertices: Vec2[];
  centroid: Vec2;
  areaKm2: number;
  sourceAreaKm2: number;
  simplificationError: number;
};

export type CollisionPart = {
  ringId: string;
  kind: RingKind;
  vertices: Vec2[];
};

export type IslandMarker = {
  ringId: string;
  label: string;
  position: Vec2;
  areaKm2: number;
};

export type SourceReference = {
  label: string;
  url: string;
  revision: string;
  sha256?: string;
  acquiredAt?: string;
  tile?: { z: number; x: number; y: number };
};

export type PrefectureAsset = {
  code: string;
  nameJa: string;
  nameEn: string;
  region: RegionId;
  color: string;
  retainedAreaKm2: number;
  mass: number;
  centerOfMass: Vec2;
  renderRings: RenderRing[];
  collisionParts: CollisionPart[];
  islandMarkers: IslandMarker[];
  bounds: Bounds;
  mainBounds: Bounds;
  sources: SourceReference[];
};

export type PrefectureAssetCollection = {
  schemaVersion: 1;
  projection: string;
  generatedAt: string;
  sourceRevision: string;
  sourceManifest: SourceReference[];
  medianAreaKm2: number;
  assets: PrefectureAsset[];
};

export type GamePhase = 'placing' | 'falling' | 'settling' | 'gameOver';

export type PersistedRecords = {
  bestScore: number;
  bestHeightKm: number;
};

export type GameSnapshot = {
  phase: GamePhase;
  score: number;
  heightKm: number;
  currentName: string;
  nextName: string;
  seed: number;
  records: PersistedRecords;
};

export type SerializedPiece = {
  prefectureCode: string;
  position: Vec2;
  angle: number;
  velocity: Vec2;
  angularVelocity: number;
  isSleeping: boolean;
};
