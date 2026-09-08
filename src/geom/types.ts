/** Basic 2D geometry types shared by the whole pipeline. Units are millimetres unless stated. */
export type Pt = [number, number];
/** Closed ring; first point is not repeated at the end. */
export type Ring = Pt[];
/** Polygon: ring[0] is the outer boundary, the rest are holes. Matches polygon-clipping's format. */
export type Poly = Ring[];
export type MultiPoly = Poly[];

export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function emptyBox(): Box {
  return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
}

export function boxOf(mp: MultiPoly): Box {
  const b = emptyBox();
  for (const poly of mp)
    for (const ring of poly)
      for (const [x, y] of ring) {
        if (x < b.minX) b.minX = x;
        if (x > b.maxX) b.maxX = x;
        if (y < b.minY) b.minY = y;
        if (y > b.maxY) b.maxY = y;
      }
  if (!isFinite(b.minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return b;
}

export function boxW(b: Box): number {
  return b.maxX - b.minX;
}
export function boxH(b: Box): number {
  return b.maxY - b.minY;
}
export function boxUnion(a: Box, b: Box): Box {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

/** Signed area; positive = counter-clockwise in a y-up system. */
export function ringArea(r: Ring): number {
  let a = 0;
  for (let i = 0, n = r.length; i < n; i++) {
    const [x1, y1] = r[i];
    const [x2, y2] = r[(i + 1) % n];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

export function multiArea(mp: MultiPoly): number {
  let a = 0;
  for (const poly of mp) for (const ring of poly) a += Math.abs(ringArea(ring)) * (ring === poly[0] ? 1 : -1);
  return a;
}

export function pointInRing(p: Pt, r: Ring): boolean {
  let inside = false;
  const [px, py] = p;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i];
    const [xj, yj] = r[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** True when the point is inside the filled area of the polygon (inside outer, outside all holes). */
export function pointInPoly(p: Pt, poly: Poly): boolean {
  if (!pointInRing(p, poly[0])) return false;
  for (let i = 1; i < poly.length; i++) if (pointInRing(p, poly[i])) return false;
  return true;
}

export function pointInMulti(p: Pt, mp: MultiPoly): boolean {
  return mp.some((poly) => pointInPoly(p, poly));
}

export function transformMulti(mp: MultiPoly, f: (p: Pt) => Pt): MultiPoly {
  return mp.map((poly) => poly.map((ring) => ring.map(f)));
}

export function translateMulti(mp: MultiPoly, dx: number, dy: number): MultiPoly {
  return transformMulti(mp, ([x, y]) => [x + dx, y + dy]);
}

export function scaleMulti(mp: MultiPoly, s: number, cx = 0, cy = 0): MultiPoly {
  return transformMulti(mp, ([x, y]) => [cx + (x - cx) * s, cy + (y - cy) * s]);
}

export function rotateMulti(mp: MultiPoly, deg: number, cx = 0, cy = 0): MultiPoly {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return transformMulti(mp, ([x, y]) => {
    const dx = x - cx;
    const dy = y - cy;
    return [cx + dx * c - dy * s, cy + dx * s + dy * c];
  });
}

export function mirrorXMulti(mp: MultiPoly, cx = 0): MultiPoly {
  // Mirroring flips orientation; reverse rings so the winding stays valid.
  return mp.map((poly) => poly.map((ring) => ring.map(([x, y]): Pt => [2 * cx - x, y]).reverse()));
}

export function cloneMulti(mp: MultiPoly): MultiPoly {
  return mp.map((poly) => poly.map((ring) => ring.map(([x, y]): Pt => [x, y])));
}

export function dist(a: Pt, b: Pt): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}
