import pc from 'polygon-clipping';
import { ringArea, type MultiPoly, type Poly, type Pt, type Ring } from './types';

type PcGeom = Parameters<typeof pc.union>[0];

/** Snap coordinates to a grid; polygon-clipping is fragile with near-coincident float points. */
let SNAP = 1e-4;
function snap(v: number): number {
  return Math.round(v / SNAP) * SNAP;
}
function toPc(mp: MultiPoly): PcGeom {
  return mp.map((poly) => poly.map((ring) => ring.map(([x, y]) => [snap(x), snap(y)]))) as unknown as PcGeom;
}

/** Run a clipping op, retrying with coarser snapping when the sweep line trips over precision. */
function safe(run: () => unknown, fallback: MultiPoly): MultiPoly {
  const grids = [1e-4, 1e-3, 1e-2, 5e-2];
  for (const g of grids) {
    SNAP = g;
    try {
      const r = run();
      SNAP = grids[0];
      return fromPc(r);
    } catch {
      /* retry coarser */
    }
  }
  SNAP = grids[0];
  return fallback;
}
function fromPc(g: unknown): MultiPoly {
  // polygon-clipping repeats the first point at the end of every ring; drop it and any duplicates.
  return (g as MultiPoly).map((poly) => poly.map((ring) => dedupeRing(ring))).filter((poly) => poly[0] && poly[0].length >= 3);
}

export function dedupeRing(ring: Ring): Ring {
  const out: Ring = [];
  for (const [x, y] of ring) {
    const last = out[out.length - 1];
    if (last && Math.abs(last[0] - x) < 1e-9 && Math.abs(last[1] - y) < 1e-9) continue;
    out.push([x, y]);
  }
  while (out.length > 1 && Math.abs(out[0][0] - out[out.length - 1][0]) < 1e-9 && Math.abs(out[0][1] - out[out.length - 1][1]) < 1e-9) out.pop();
  return out;
}

export function union(...mps: MultiPoly[]): MultiPoly {
  const parts = mps.filter((m) => m.length);
  if (!parts.length) return [];
  if (parts.length === 1) return normalize(parts[0]);
  return safe(() => pc.union(toPc(parts[0]), ...parts.slice(1).map(toPc)), parts.flat());
}

export function difference(a: MultiPoly, ...bs: MultiPoly[]): MultiPoly {
  const subs = bs.filter((m) => m.length);
  if (!a.length) return [];
  if (!subs.length) return normalize(a);
  return safe(() => pc.difference(toPc(a), ...subs.map(toPc)), a);
}

export function intersection(a: MultiPoly, b: MultiPoly): MultiPoly {
  if (!a.length || !b.length) return [];
  return safe(() => pc.intersection(toPc(a), toPc(b)), []);
}

/** Runs a self-union which repairs winding, self-intersections and duplicate points. */
export function normalize(mp: MultiPoly): MultiPoly {
  if (!mp.length) return [];
  return safe(() => pc.union(toPc(mp)), mp);
}

/** Drops polygons whose net area is under minArea (mm²). */
export function dropSmall(mp: MultiPoly, minArea: number): MultiPoly {
  return mp.filter((poly) => Math.abs(ringArea(poly[0])) >= minArea);
}

export function circleRing(cx: number, cy: number, r: number, segs = 48): Ring {
  const ring: Ring = [];
  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    ring.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return ring;
}

export function circle(cx: number, cy: number, r: number, segs = 48): MultiPoly {
  return [[circleRing(cx, cy, r, segs)]];
}

export function rect(x: number, y: number, w: number, h: number): MultiPoly {
  return [
    [
      [
        [x, y],
        [x + w, y],
        [x + w, y + h],
        [x, y + h],
      ],
    ],
  ];
}

export function roundedRect(x: number, y: number, w: number, h: number, r: number, segs = 10): MultiPoly {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  if (r === 0) return rect(x, y, w, h);
  const ring: Ring = [];
  const corner = (cx: number, cy: number, a0: number) => {
    for (let i = 0; i <= segs; i++) {
      const a = a0 + (i / segs) * (Math.PI / 2);
      ring.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
  };
  corner(x + w - r, y + h - r, 0);
  corner(x + r, y + h - r, Math.PI / 2);
  corner(x + r, y + r, Math.PI);
  corner(x + w - r, y + r, Math.PI * 1.5);
  return [[ring]];
}

export function ellipse(cx: number, cy: number, rx: number, ry: number, segs = 72): MultiPoly {
  const ring: Ring = [];
  for (let i = 0; i < segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    ring.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  return [[ring]];
}

/** Stadium / capsule: rectangle with fully rounded short ends. */
export function capsule(x: number, y: number, w: number, h: number): MultiPoly {
  return roundedRect(x, y, w, h, Math.min(w, h) / 2, 16);
}

/**
 * Offset (buffer) a polygon set by distance d using the Minkowski-sum-with-disk
 * construction: union of the shape, edge rectangles and vertex discs. Negative
 * d shrinks: computed as the complement trick on a padded bounding box.
 */
export function offset(mp: MultiPoly, d: number, segs = 24): MultiPoly {
  if (!mp.length || d === 0) return normalize(mp);
  if (d < 0) {
    // Shrink = big box minus offset(big box minus shape).
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const poly of mp)
      for (const ring of poly)
        for (const [x, y] of ring) {
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
    const pad = -d * 3 + 1;
    const box = rect(minX - pad, minY - pad, maxX - minX + 2 * pad, maxY - minY + 2 * pad);
    const inv = difference(box, mp);
    const grown = offset(inv, -d, segs);
    return difference(box, grown);
  }
  const pieces: MultiPoly = [];
  for (const poly of mp) {
    pieces.push(poly);
    for (const ring of poly) {
      const n = ring.length;
      for (let i = 0; i < n; i++) {
        const [ax, ay] = ring[i];
        const [bx, by] = ring[(i + 1) % n];
        const dx = bx - ax;
        const dy = by - ay;
        const len = Math.hypot(dx, dy);
        if (len > 1e-9) {
          const nx = (-dy / len) * d;
          const ny = (dx / len) * d;
          pieces.push([
            [
              [ax + nx, ay + ny],
              [bx + nx, by + ny],
              [bx - nx, by - ny],
              [ax - nx, ay - ny],
            ],
          ]);
        }
        pieces.push([circleRing(ax, ay, d, segs)]);
      }
    }
  }
  return union(pieces);
}

/** Ring outline (frame border) of a filled shape: shape minus shrunk shape. */
export function ringOf(mp: MultiPoly, border: number): MultiPoly {
  return difference(mp, offset(mp, -border));
}

/** Replace vertex i of ring with a circular fillet of radius r. */
export function filletVertex(ring: Ring, i: number, r: number, segs = 8): Ring {
  const n = ring.length;
  if (n < 3 || r <= 0) return ring;
  const p = ring[i];
  const a = ring[(i - 1 + n) % n];
  const b = ring[(i + 1) % n];
  const la = Math.hypot(a[0] - p[0], a[1] - p[1]);
  const lb = Math.hypot(b[0] - p[0], b[1] - p[1]);
  if (la < 1e-9 || lb < 1e-9) return ring;
  const ua: Pt = [(a[0] - p[0]) / la, (a[1] - p[1]) / la];
  const ub: Pt = [(b[0] - p[0]) / lb, (b[1] - p[1]) / lb];
  const cosT = Math.max(-1, Math.min(1, ua[0] * ub[0] + ua[1] * ub[1]));
  const theta = Math.acos(cosT); // interior angle at p
  if (theta > Math.PI - 0.02 || theta < 0.02) return ring;
  // Tangent distance from p along each edge.
  let t = r / Math.tan(theta / 2);
  const tMax = Math.min(la, lb) * 0.5;
  if (t > tMax) {
    t = tMax;
    r = t * Math.tan(theta / 2);
  }
  const pa: Pt = [p[0] + ua[0] * t, p[1] + ua[1] * t];
  const pb: Pt = [p[0] + ub[0] * t, p[1] + ub[1] * t];
  // Arc centre lies along the bisector at distance r / sin(theta/2).
  const bis: Pt = [ua[0] + ub[0], ua[1] + ub[1]];
  const bl = Math.hypot(bis[0], bis[1]);
  const c: Pt = [p[0] + (bis[0] / bl) * (r / Math.sin(theta / 2)), p[1] + (bis[1] / bl) * (r / Math.sin(theta / 2))];
  const a0 = Math.atan2(pa[1] - c[1], pa[0] - c[0]);
  let a1 = Math.atan2(pb[1] - c[1], pb[0] - c[0]);
  let da = a1 - a0;
  while (da > Math.PI) da -= 2 * Math.PI;
  while (da < -Math.PI) da += 2 * Math.PI;
  a1 = a0 + da;
  const arc: Pt[] = [];
  for (let k = 0; k <= segs; k++) {
    const ang = a0 + (da * k) / segs;
    arc.push([c[0] + r * Math.cos(ang), c[1] + r * Math.sin(ang)]);
  }
  return ring.slice(0, i).concat(arc, ring.slice(i + 1));
}

export function polyVertexCount(mp: MultiPoly): number {
  let n = 0;
  for (const poly of mp) for (const ring of poly) n += ring.length;
  return n;
}

export function isPoly(p: unknown): p is Poly {
  return Array.isArray(p);
}
