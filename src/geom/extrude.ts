import earcut from 'earcut';
import type { MultiPoly } from './types';

export interface Mesh {
  /** xyz triples */
  positions: Float32Array;
  /** triangle vertex indices */
  indices: Uint32Array;
}

/**
 * Extrude a multipolygon between z0 and z1 (mm). X/Y are used as-is.
 * Caps are triangulated with earcut; walls are quads per edge.
 * Winding: top cap faces +z, bottom faces -z, walls outward, assuming the
 * outer rings are counter-clockwise in a y-up system (polygon-clipping output).
 */
export function extrude(mp: MultiPoly, z0: number, z1: number): Mesh {
  const pos: number[] = [];
  const idx: number[] = [];
  for (const rawPoly of mp) {
    const poly = rawPoly.map(dedupe).filter((r) => r.length >= 3);
    if (!poly.length) continue;
    const flat: number[] = [];
    const holeIdx: number[] = [];
    for (let r = 0; r < poly.length; r++) {
      if (r > 0) holeIdx.push(flat.length / 2);
      for (const [x, y] of poly[r]) flat.push(x, y);
    }
    const tris = earcut(flat, holeIdx, 2);
    const nv = flat.length / 2;
    const base = pos.length / 3;
    // bottom vertices then top vertices
    for (let i = 0; i < nv; i++) pos.push(flat[i * 2], flat[i * 2 + 1], z0);
    for (let i = 0; i < nv; i++) pos.push(flat[i * 2], flat[i * 2 + 1], z1);
    // earcut returns CCW triangles for CCW input in y-up: top = as-is, bottom = reversed.
    for (let t = 0; t < tris.length; t += 3) {
      idx.push(base + nv + tris[t], base + nv + tris[t + 1], base + nv + tris[t + 2]);
      idx.push(base + tris[t + 2], base + tris[t + 1], base + tris[t]);
    }
    // walls
    let off = 0;
    for (let r = 0; r < poly.length; r++) {
      const n = poly[r].length;
      const ccw = signedArea(poly[r]) > 0;
      for (let i = 0; i < n; i++) {
        const a = base + off + i;
        const b = base + off + ((i + 1) % n);
        const at = a + nv;
        const bt = b + nv;
        // For an outer CCW ring, the outward normal is on the right of a->b; for holes (CW) same rule flips.
        if (ccw === (r === 0)) idx.push(a, b, bt, a, bt, at);
        else idx.push(b, a, at, b, at, bt);
      }
      off += n;
    }
  }
  return { positions: new Float32Array(pos), indices: new Uint32Array(idx) };
}

function dedupe(ring: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (const p of ring) {
    const l = out[out.length - 1];
    if (l && Math.abs(l[0] - p[0]) < 1e-9 && Math.abs(l[1] - p[1]) < 1e-9) continue;
    out.push(p);
  }
  while (out.length > 1 && Math.abs(out[0][0] - out[out.length - 1][0]) < 1e-9 && Math.abs(out[0][1] - out[out.length - 1][1]) < 1e-9) out.pop();
  return out;
}

function signedArea(ring: [number, number][]): number {
  let a = 0;
  for (let i = 0, n = ring.length; i < n; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % n];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

export function mergeMeshes(meshes: Mesh[]): Mesh {
  let nv = 0;
  let ni = 0;
  for (const m of meshes) {
    nv += m.positions.length;
    ni += m.indices.length;
  }
  const positions = new Float32Array(nv);
  const indices = new Uint32Array(ni);
  let vo = 0;
  let io = 0;
  for (const m of meshes) {
    positions.set(m.positions, vo);
    const base = vo / 3;
    for (let i = 0; i < m.indices.length; i++) indices[io + i] = m.indices[i] + base;
    vo += m.positions.length;
    io += m.indices.length;
  }
  return { positions, indices };
}
