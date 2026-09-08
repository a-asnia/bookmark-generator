import type { Mask } from './bitmap';
import { ringArea, pointInRing, type MultiPoly, type Pt, type Ring } from './types';

/**
 * Convert a binary mask into closed rings by walking pixel boundaries.
 * Output coordinates are in pixels (y down). Outer rings have positive
 * area (clockwise on screen), holes negative. Regions that only touch
 * diagonally stay separate (4-connectivity).
 */
export function traceMask(m: Mask): Ring[] {
  const { w, h, data } = m;
  const W = w + 1; // vertex grid width
  const at = (x: number, y: number) => (y >= 0 && y < h && x >= 0 && x < w ? data[y * w + x] : 0);
  // Edge storage: for every vertex, outgoing directions bitmask. dir: 0=+x, 1=+y, 2=-x, 3=-y
  const out = new Uint8Array(W * (h + 1));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!data[y * w + x]) continue;
      if (!at(x, y - 1)) out[y * W + x] |= 1 << 0; // top: (x,y) -> (x+1,y)
      if (!at(x + 1, y)) out[y * W + x + 1] |= 1 << 1; // right: (x+1,y) -> (x+1,y+1)
      if (!at(x, y + 1)) out[(y + 1) * W + x + 1] |= 1 << 2; // bottom: (x+1,y+1) -> (x,y+1)
      if (!at(x - 1, y)) out[(y + 1) * W + x] |= 1 << 3; // left: (x,y+1) -> (x,y)
    }
  }
  const DX = [1, 0, -1, 0];
  const DY = [0, 1, 0, -1];
  const rings: Ring[] = [];
  for (let start = 0; start < out.length; start++) {
    while (out[start]) {
      // Pick any outgoing edge to begin.
      let dir = 0;
      while (!(out[start] & (1 << dir))) dir++;
      const ring: Ring = [];
      let v = start;
      let prevDir = -1;
      let guard = 0;
      for (;;) {
        // Choose outgoing edge: prefer right turn, then straight, then left (keeps regions 4-connected).
        let d = -1;
        if (prevDir < 0) d = dir;
        else {
          const order = [(prevDir + 1) & 3, prevDir, (prevDir + 3) & 3];
          for (const cand of order)
            if (out[v] & (1 << cand)) {
              d = cand;
              break;
            }
        }
        if (d < 0) break; // should not happen on a closed boundary
        out[v] &= ~(1 << d);
        const x = v % W;
        const y = (v - x) / W;
        // Skip collinear vertices to keep rings light.
        if (d !== prevDir) ring.push([x, y]);
        v = (y + DY[d]) * W + (x + DX[d]);
        prevDir = d;
        if (v === start) break;
        if (++guard > out.length * 4) break;
      }
      // If the first point was collinear with the closing edge, drop it.
      if (ring.length >= 3) {
        const a = ring[ring.length - 1];
        const b = ring[0];
        const c = ring[1];
        if ((a[0] === b[0] && b[0] === c[0]) || (a[1] === b[1] && b[1] === c[1])) ring.shift();
      }
      if (ring.length >= 3) rings.push(ring);
    }
  }
  return rings;
}

/** Ramer–Douglas–Peucker for a closed ring. Keeps at least a triangle. */
export function simplifyRing(ring: Ring, tol: number): Ring {
  if (tol <= 0 || ring.length <= 4) return ring;
  const n = ring.length;
  // Split at the two farthest points so the closed ring is handled as two open chains.
  let i0 = 0;
  let far = 0;
  for (let i = 1; i < n; i++) {
    const d = (ring[i][0] - ring[0][0]) ** 2 + (ring[i][1] - ring[0][1]) ** 2;
    if (d > far) {
      far = d;
      i0 = i;
    }
  }
  const chainA = ring.slice(0, i0 + 1);
  const chainB = ring.slice(i0).concat([ring[0]]);
  const a = dp(chainA, tol);
  const b = dp(chainB, tol);
  const res = a.slice(0, -1).concat(b.slice(0, -1));
  return res.length >= 3 ? res : ring;
}

function dp(pts: Pt[], tol: number): Pt[] {
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  const t2 = tol * tol;
  while (stack.length) {
    const [s, e] = stack.pop()!;
    if (e - s < 2) continue;
    const [ax, ay] = pts[s];
    const [bx, by] = pts[e];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let maxD = -1;
    let idx = -1;
    for (let i = s + 1; i < e; i++) {
      const [px, py] = pts[i];
      let d: number;
      if (len2 === 0) d = (px - ax) ** 2 + (py - ay) ** 2;
      else {
        const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
        d = (px - (ax + t * dx)) ** 2 + (py - (ay + t * dy)) ** 2;
      }
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > t2) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  const out: Pt[] = [];
  for (let i = 0; i < pts.length; i++) if (keep[i]) out.push(pts[i]);
  return out;
}

/** Group rings into polygons: each hole goes to the smallest outer ring containing it. */
export function ringsToMulti(rings: Ring[], minArea = 0): MultiPoly {
  const outers: { ring: Ring; area: number }[] = [];
  const holes: { ring: Ring; area: number }[] = [];
  for (const r of rings) {
    const a = ringArea(r);
    if (Math.abs(a) < minArea) continue;
    if (a > 0) outers.push({ ring: r, area: a });
    else holes.push({ ring: r, area: -a });
  }
  outers.sort((p, q) => p.area - q.area);
  const polys: MultiPoly = outers.map((o) => [o.ring]);
  for (const hole of holes) {
    const p = hole.ring[0];
    for (let i = 0; i < outers.length; i++) {
      if (outers[i].area > hole.area && pointInRing(p, outers[i].ring)) {
        polys[i].push(hole.ring);
        break;
      }
    }
  }
  return polys;
}
