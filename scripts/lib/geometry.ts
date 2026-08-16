import type { Bounds, Vec2 } from '../../src/types';

export function signedArea(vertices: Vec2[]): number {
  let sum = 0;
  for (let index = 0; index < vertices.length; index += 1) {
    const current = vertices[index]!;
    const next = vertices[(index + 1) % vertices.length]!;
    sum += current.x * next.y - next.x * current.y;
  }
  return sum / 2;
}

export function area(vertices: Vec2[]): number {
  return Math.abs(signedArea(vertices));
}

export function centroid(vertices: Vec2[]): Vec2 {
  const signed = signedArea(vertices);
  if (Math.abs(signed) < 1e-9) {
    const total = vertices.reduce((sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }), { x: 0, y: 0 });
    return { x: total.x / vertices.length, y: total.y / vertices.length };
  }

  let x = 0;
  let y = 0;
  for (let index = 0; index < vertices.length; index += 1) {
    const current = vertices[index]!;
    const next = vertices[(index + 1) % vertices.length]!;
    const cross = current.x * next.y - next.x * current.y;
    x += (current.x + next.x) * cross;
    y += (current.y + next.y) * cross;
  }
  return { x: x / (6 * signed), y: y / (6 * signed) };
}

export function boundsOf(rings: Vec2[][]): Bounds {
  const points = rings.flat();
  const min = {
    x: Math.min(...points.map((point) => point.x)),
    y: Math.min(...points.map((point) => point.y)),
  };
  const max = {
    x: Math.max(...points.map((point) => point.x)),
    y: Math.max(...points.map((point) => point.y)),
  };
  return { min, max, width: max.x - min.x, height: max.y - min.y };
}

function triangleArea(a: Vec2, b: Vec2, c: Vec2): number {
  return Math.abs((a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y)) / 2);
}

function removeLeastImportant(vertices: Vec2[]): Vec2[] {
  let leastIndex = 0;
  let leastArea = Number.POSITIVE_INFINITY;
  for (let index = 0; index < vertices.length; index += 1) {
    const score = triangleArea(
      vertices[(index - 1 + vertices.length) % vertices.length]!,
      vertices[index]!,
      vertices[(index + 1) % vertices.length]!,
    );
    if (score < leastArea) {
      leastArea = score;
      leastIndex = index;
    }
  }
  return vertices.filter((_, index) => index !== leastIndex);
}

function densify(vertices: Vec2[], target: number): Vec2[] {
  const output = [...vertices];
  while (output.length < target) {
    let longestIndex = 0;
    let longestLength = -1;
    for (let index = 0; index < output.length; index += 1) {
      const current = output[index]!;
      const next = output[(index + 1) % output.length]!;
      const distance = (next.x - current.x) ** 2 + (next.y - current.y) ** 2;
      if (distance > longestLength) {
        longestLength = distance;
        longestIndex = index;
      }
    }
    const a = output[longestIndex]!;
    const b = output[(longestIndex + 1) % output.length]!;
    output.splice(longestIndex + 1, 0, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  }
  return output;
}

export function simplifyVisvalingam(vertices: Vec2[], minVertices: number, maxVertices: number): Vec2[] {
  const originalArea = area(vertices);
  let current = [...vertices];
  let best = current;

  while (current.length > minVertices) {
    const candidate = removeLeastImportant(current);
    const error = originalArea === 0 ? 0 : Math.abs(area(candidate) - originalArea) / originalArea;
    if (candidate.length <= maxVertices && error <= 0.02) best = candidate;
    current = candidate;
    if (current.length <= maxVertices && error > 0.02) break;
  }

  if (best.length > maxVertices) {
    best = current;
    while (best.length > maxVertices) best = removeLeastImportant(best);
  }
  if (best.length < minVertices) best = densify(best, minVertices);
  return best;
}

export function isConvex(vertices: Vec2[]): boolean {
  if (vertices.length < 3) return false;
  let direction = 0;
  for (let index = 0; index < vertices.length; index += 1) {
    const a = vertices[index]!;
    const b = vertices[(index + 1) % vertices.length]!;
    const c = vertices[(index + 2) % vertices.length]!;
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) < 1e-8) continue;
    const nextDirection = Math.sign(cross);
    if (direction !== 0 && direction !== nextDirection) return false;
    direction = nextDirection;
  }
  return direction !== 0;
}

function orientation(a: Vec2, b: Vec2, c: Vec2): number {
  return Math.sign((b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y));
}

function segmentsIntersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  return orientation(a, b, c) !== orientation(a, b, d) && orientation(c, d, a) !== orientation(c, d, b);
}

export function isSimple(vertices: Vec2[]): boolean {
  for (let first = 0; first < vertices.length; first += 1) {
    const firstNext = (first + 1) % vertices.length;
    for (let second = first + 1; second < vertices.length; second += 1) {
      const secondNext = (second + 1) % vertices.length;
      if (first === second || firstNext === second || secondNext === first) continue;
      if (segmentsIntersect(vertices[first]!, vertices[firstNext]!, vertices[second]!, vertices[secondNext]!)) return false;
    }
  }
  return true;
}

export function roundPoint(point: Vec2): Vec2 {
  return { x: Number(point.x.toFixed(4)), y: Number(point.y.toFixed(4)) };
}
