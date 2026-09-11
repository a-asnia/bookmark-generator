import {
  dilate,
  floodFill,
  imageToMask,
  maskBounds,
  paintDisk,
  paintSegment,
  removeSpecks,
  type Mask,
} from '../geom/bitmap';
import { extrude, type Mesh } from '../geom/extrude';
import { difference, dropSmall, filletVertex, intersection, normalize, rect, roundedRect, union } from '../geom/ops';
import { frameGeometry, holderShape, standProfile, type FrameParams } from '../geom/shapes';
import { ringsToMulti, simplifyRing, smoothRing, traceMask } from '../geom/trace';
import {
  boxH,
  boxOf,
  boxW,
  dist,
  pointInRing,
  ringArea,
  transformMulti,
  type Box,
  type MultiPoly,
  type Pt,
} from '../geom/types';
import type { Edit, Project, SourceImage } from './state';

/** Maximum working resolution (long side). Keeps tracing fast on phones. */
export const MAX_WORK_PX = 1400;

// ---------------------------------------------------------------------------
// Stage 1: raster

export function buildMask(src: SourceImage, p: Project, mmPerPx: number): Mask {
  const m = imageToMask(src.data, {
    threshold: p.image.threshold,
    useAlpha: p.image.useAlpha && src.hasAlpha,
    invert: p.image.invert,
  });
  for (const e of p.edits) {
    if (e.kind === 'paint' || e.kind === 'erase') {
      const v = e.kind === 'paint' ? 1 : 0;
      if (e.points.length === 1) paintDisk(m, e.points[0][0], e.points[0][1], e.radius, v);
      for (let i = 1; i < e.points.length; i++) {
        const a = e.points[i - 1];
        const b = e.points[i];
        paintSegment(m, a[0], a[1], b[0], b[1], e.radius, v);
      }
    } else if (e.kind === 'fill') {
      floodFill(m, Math.floor(e.p[0]), Math.floor(e.p[1]), 1);
    }
  }
  const minPx = mmPerPx > 0 ? p.image.despeckle / (mmPerPx * mmPerPx) : 0;
  let out = removeSpecks(m, Math.round(minPx));
  const dil = p.image.thicken / 2 / mmPerPx;
  if (dil >= 0.5) out = dilate(out, dil);
  return out;
}

// ---------------------------------------------------------------------------
// Stage 2: vector (still in pixels, y down)

/**
 * Trace and smooth. `smooth` is 0..1: 0 keeps the pixel outline (only the
 * staircase is straightened), 1 rounds everything except sharp corners.
 */
export function traceToPolys(mask: Mask, smooth: number, minAreaPx: number): MultiPoly {
  const s = Math.max(0, Math.min(1, smooth));
  const tol = 0.45 + s * 1.2; // px, Douglas-Peucker before smoothing
  const iterations = s < 0.15 ? 0 : s < 0.45 ? 1 : s < 0.75 ? 2 : 3;
  const cornerDeg = 60 + s * 40; // 60..100°: stronger smoothing rounds blunter corners too
  const rings = traceMask(mask).map((r) => {
    let ring = simplifyRing(r, tol);
    ring = smoothRing(ring, iterations, cornerDeg);
    // Cull the extra points the subdivision produced.
    return iterations ? simplifyRing(ring, 0.12) : ring;
  });
  return ringsToMulti(rings, minAreaPx);
}

/** Apply hole fills and island deletions (point based, so they survive re-tracing). */
export function applyPointEdits(mp: MultiPoly, edits: Edit[]): MultiPoly {
  let out = mp;
  for (const e of edits) {
    if (e.kind === 'delete') {
      out = out.filter((poly) => !(pointInRing(e.p, poly[0]) && !poly.slice(1).some((h) => pointInRing(e.p, h))));
    }
  }
  return out;
}

/** Vector corrections: vertex moves and corner rounding, matched by proximity. */
export function applyVectorEdits(mp: MultiPoly, edits: Edit[], tolerance: number): MultiPoly {
  let out = mp.map((poly) => poly.map((ring) => ring.slice()));
  for (const e of edits) {
    if (e.kind === 'move') {
      const hit = nearestVertex(out, e.from, tolerance);
      if (hit) out[hit.poly][hit.ring][hit.index] = [e.to[0], e.to[1]];
    } else if (e.kind === 'round') {
      const hit = nearestVertex(out, e.p, tolerance);
      if (hit) out[hit.poly][hit.ring] = filletVertex(out[hit.poly][hit.ring], hit.index, e.radius);
    }
  }
  return out;
}

export function nearestVertex(mp: MultiPoly, p: Pt, tolerance: number): { poly: number; ring: number; index: number; d: number } | null {
  let best: { poly: number; ring: number; index: number; d: number } | null = null;
  for (let i = 0; i < mp.length; i++)
    for (let r = 0; r < mp[i].length; r++) {
      const ring = mp[i][r];
      for (let k = 0; k < ring.length; k++) {
        const d = dist(ring[k], p);
        if (d <= tolerance && (!best || d < best.d)) best = { poly: i, ring: r, index: k, d };
      }
    }
  return best;
}

// ---------------------------------------------------------------------------
// Stage 3: placement into millimetres (y up)

export interface Placed {
  /** picture in mm, y up */
  poly: MultiPoly;
  /** px -> mm */
  toMm: (p: Pt) => Pt;
  /** mm -> px */
  toPx: (p: Pt) => Pt;
  /** mm per pixel at the final scale */
  mmPerPx: number;
}

/**
 * Fit the picture's bounding box into a target box (mm) then apply the user's
 * scale / offset / rotation. Anchor decides which edge is pinned:
 * 'center' for frames and free mode, 'bottom' for toppers (bottom edge at anchorY).
 */
export function placePicture(
  polyPx: MultiPoly,
  bboxPx: Box,
  target: { w: number; h: number; cx: number; cy: number; anchor: 'center' | 'bottom' },
  placement: Project['placement'],
): Placed {
  const pw = Math.max(1, boxW(bboxPx));
  const ph = Math.max(1, boxH(bboxPx));
  const fit = target.h > 0 ? Math.min(target.w / pw, target.h / ph) : target.w / pw;
  const s = fit * placement.scale;
  const cx = (bboxPx.minX + bboxPx.maxX) / 2;
  const cy = (bboxPx.minY + bboxPx.maxY) / 2;
  const ang = (placement.rotation * Math.PI) / 180;
  const cos = Math.cos(ang);
  const sin = Math.sin(ang);
  const flip = placement.flipX ? -1 : 1;
  // Unrotated picture in mm, centred at origin.
  const halfH = (ph * s) / 2;
  const ay = target.anchor === 'bottom' ? target.cy + halfH : target.cy;
  const toMm = ([x, y]: Pt): Pt => {
    const lx = (x - cx) * s * flip;
    const ly = -(y - cy) * s;
    return [target.cx + placement.dx + lx * cos - ly * sin, ay + placement.dy + lx * sin + ly * cos];
  };
  const toPx = ([X, Y]: Pt): Pt => {
    const rx = X - target.cx - placement.dx;
    const ry = Y - ay - placement.dy;
    const lx = rx * cos + ry * sin;
    const ly = -rx * sin + ry * cos;
    return [cx + (lx / (s * flip)), cy - ly / s];
  };
  let poly = transformMulti(polyPx, toMm);
  if (placement.flipX) poly = poly.map((p) => p.map((r) => r.slice().reverse()));
  return { poly, toMm, toPx, mmPerPx: s };
}

// ---------------------------------------------------------------------------
// Stage 4: assembly

export interface Part {
  id: string;
  name: string;
  /** footprint in mm, y up (for the 2D editor) */
  poly: MultiPoly;
  z0: number;
  z1: number;
  extruder: number;
  color: string;
  mesh: Mesh;
  /** Which editor role this part plays. */
  role: 'base' | 'image' | 'relief' | 'stand' | 'backing';
}

export interface ExportObject {
  id: string;
  name: string;
  parts: Part[];
  /** Placement offset on the plate (mm). */
  offset: [number, number];
}

export interface Assembly {
  objects: ExportObject[];
  /** Total footprint of the bookmark (object 0) in mm. */
  bounds: Box;
  warnings: string[];
  placed: Placed | null;
  /** Everything the picture must touch (frame ring or holder), for editor hints. */
  base: MultiPoly;
  /** Interior box of the frame / holder the picture is fitted into. */
  fitBox: Box | null;
  /** Picture pieces dropped because they touch nothing (shown as ghosts in the editor). */
  floating: MultiPoly;
}

/** Backing plate footprint for the picture. `interior` is the frame interior when in frame mode. */
export function backingShape(p: Project, picture: MultiPoly, interior: MultiPoly | null): MultiPoly {
  const b = p.backing;
  if (!b.enabled) return [];
  const shape = b.shape === 'frame' && !interior ? 'plate' : b.shape;
  if (shape === 'frame' && interior) return interior;
  if (shape === 'silhouette') return silhouette(picture);
  if (!picture.length) return [];
  const bb = boxOf(picture);
  let plate = roundedRect(bb.minX - b.margin, bb.minY - b.margin, boxW(bb) + 2 * b.margin, boxH(bb) + 2 * b.margin, b.cornerRadius);
  if (interior) plate = intersection(plate, interior);
  return plate;
}

export function silhouette(mp: MultiPoly): MultiPoly {
  return normalize(mp.map((poly) => [poly[0]]));
}

function segDist2(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  const x = a[0] + t * dx - p[0];
  const y = a[1] + t * dy - p[1];
  return x * x + y * y;
}

/** True when the polygon overlaps the base or one of its vertices lies within eps of the base outline. */
export function touches(poly: MultiPoly[number], base: MultiPoly, eps: number): boolean {
  const bb = boxOf(base);
  const b = boxOf([poly]);
  if (b.maxX < bb.minX - eps || b.minX > bb.maxX + eps || b.maxY < bb.minY - eps || b.minY > bb.maxY + eps) return false;
  const e2 = eps * eps;
  for (const ring of poly)
    for (const p of ring) {
      for (const bp of base)
        for (const br of bp) {
          const n = br.length;
          for (let i = 0; i < n; i++) if (segDist2(p, br[i], br[(i + 1) % n]) <= e2) return true;
        }
    }
  return intersection([poly], base).length > 0;
}

/** Keep only picture pieces touching the base shape (edge contact counts). */
export function removeFloating(picture: MultiPoly, base: MultiPoly): { kept: MultiPoly; dropped: MultiPoly; removed: number } {
  if (!base.length) return { kept: picture, dropped: [], removed: 0 };
  const kept: MultiPoly = [];
  const dropped: MultiPoly = [];
  for (const poly of picture) {
    if (touches(poly, base, 0.05)) kept.push(poly);
    else dropped.push(poly);
  }
  return { kept, dropped, removed: dropped.length };
}

function mkPart(
  id: string,
  name: string,
  poly: MultiPoly,
  z0: number,
  z1: number,
  extruder: number,
  color: string,
  role: Part['role'],
): Part {
  return { id, name, poly, z0, z1, extruder, color, mesh: extrude(poly, z0, z1), role };
}

export interface PictureInput {
  /** traced & edited picture in px, y down */
  polyPx: MultiPoly;
  bboxPx: Box;
}

export function assemble(p: Project, pic: PictureInput | null, t: (k: string) => string): Assembly {
  const warnings: string[] = [];
  const pal = p.colors.palette;
  const colorOf = (i: number) => pal[i % pal.length];
  const parts: Part[] = [];
  let placed: Placed | null = null;
  let base: MultiPoly = [];
  let fitBox: Box | null = null;
  let picture: MultiPoly = [];
  let floating: MultiPoly = [];
  let imageZ0 = 0;
  let imageZ1 = 0;

  const stylize = (mp: MultiPoly): { body: MultiPoly; relief: MultiPoly } => {
    if (p.style === 'lace') return { body: mp, relief: [] };
    const sil = silhouette(mp);
    if (p.style === 'silhouette') return { body: sil, relief: [] };
    return { body: sil, relief: mp };
  };

  if (p.mode === 'frame') {
    const fp: FrameParams = { ...p.frame };
    const fg = frameGeometry(fp);
    base = fg.ring;
    const ob = boxOf(fg.outer);
    const half = 0;
    // Fit into the outer box: lines run into the frame and bond with it (clipped at the inner edge).
    const ib: Box = { minX: ob.minX + half, minY: ob.minY + half, maxX: ob.maxX - half, maxY: ob.maxY - half };
    fitBox = ib;
    if (pic) {
      placed = placePicture(pic.polyPx, pic.bboxPx, { w: boxW(ib), h: boxH(ib), cx: (ib.minX + ib.maxX) / 2, cy: (ib.minY + ib.maxY) / 2, anchor: 'center' }, p.placement);
      picture = placed.poly;
      if (p.frame.clipMode === 'clip') picture = intersection(picture, fg.inner);
      const support = p.backing.enabled ? union(fg.ring, backingShape(p, picture, fg.inner)) : fg.ring;
      const r = removeFloating(picture, support);
      if (p.image.removeFloating) {
        floating = r.dropped;
        picture = r.kept;
        if (r.removed) warnings.push(t('warn.floatingRemoved').replace('{n}', String(r.removed)));
      } else if (r.removed) warnings.push(t('warn.floating').replace('{n}', String(r.removed)));
    }
    const { body, relief } = stylize(picture);
    const backing = backingShape(p, body, fg.inner);
    const ring = difference(fg.ring, body);
    parts.push(mkPart('frame', t('part.frame'), ring, 0, p.frame.thickness, p.colors.base, colorOf(p.colors.base), 'base'));
    imageZ0 = 0;
    if (backing.length) {
      parts.push(mkPart('backing', t('part.backing'), difference(backing, fg.ring), 0, p.backing.thickness, p.colors.backing, colorOf(p.colors.backing), 'backing'));
      imageZ0 = p.backing.thickness;
    }
    imageZ1 = imageZ0 + p.frame.imageThickness;
    if (body.length) parts.push(mkPart('image', t('part.picture'), body, imageZ0, imageZ1, p.colors.image, colorOf(p.colors.image), 'image'));
    if (relief.length) parts.push(mkPart('relief', t('part.relief'), relief, imageZ1, imageZ1 + p.reliefHeight, p.colors.relief, colorOf(p.colors.relief), 'relief'));
  } else if (p.mode === 'holder') {
    const hs = holderShape({ ...p.holder });
    base = hs;
    const targetW = p.holder.width * p.holder.fit;
    fitBox = { minX: -targetW / 2, maxX: targetW / 2, minY: -p.holder.overlap, maxY: -p.holder.overlap + targetW * 1.3 };
    if (pic) {
      // Fit by width, but never let a tall drawing grow past ~1.3× the target width.
      placed = placePicture(pic.polyPx, pic.bboxPx, { w: targetW, h: targetW * 1.3, cx: 0, cy: -p.holder.overlap, anchor: 'bottom' }, p.placement);
      picture = placed.poly;
      const support = p.backing.enabled ? union(hs, backingShape(p, picture, null)) : hs;
      const r = removeFloating(picture, support);
      if (p.image.removeFloating) {
        floating = r.dropped;
        picture = r.kept;
        if (r.removed) warnings.push(t('warn.floatingRemoved').replace('{n}', String(r.removed)));
      } else if (r.removed) warnings.push(t('warn.floating').replace('{n}', String(r.removed)));
    }
    const { body, relief } = stylize(picture);
    const backing = backingShape(p, body, null);
    const holder = difference(hs, body, backing);
    parts.push(mkPart('holder', t('part.holder'), holder, 0, p.holder.thickness, p.colors.base, colorOf(p.colors.base), 'base'));
    imageZ0 = 0;
    if (backing.length) {
      parts.push(mkPart('backing', t('part.backing'), backing, 0, p.backing.thickness, p.colors.backing, colorOf(p.colors.backing), 'backing'));
      imageZ0 = p.backing.thickness;
    }
    imageZ1 = imageZ0 + p.holder.topperThickness;
    if (body.length) parts.push(mkPart('image', t('part.topper'), body, imageZ0, imageZ1, p.colors.image, colorOf(p.colors.image), 'image'));
    if (relief.length) parts.push(mkPart('relief', t('part.relief'), relief, imageZ1, imageZ1 + p.reliefHeight, p.colors.relief, colorOf(p.colors.relief), 'relief'));
  } else {
    fitBox = { minX: -p.free.width / 2, maxX: p.free.width / 2, minY: -p.free.width, maxY: p.free.width };
    if (pic) {
      placed = placePicture(pic.polyPx, pic.bboxPx, { w: p.free.width, h: 0, cx: 0, cy: 0, anchor: 'center' }, p.placement);
      picture = placed.poly;
    }
    const { body, relief } = stylize(picture);
    const backing = backingShape(p, body, null);
    imageZ0 = 0;
    if (backing.length) {
      parts.push(mkPart('backing', t('part.backing'), backing, 0, p.backing.thickness, p.colors.backing, colorOf(p.colors.backing), 'backing'));
      imageZ0 = p.backing.thickness;
    }
    imageZ1 = imageZ0 + p.free.thickness;
    if (body.length) parts.push(mkPart('image', t('part.picture'), body, imageZ0, imageZ1, p.colors.image, colorOf(p.colors.image), 'image'));
    if (relief.length) parts.push(mkPart('relief', t('part.relief'), relief, imageZ1, imageZ1 + p.reliefHeight, p.colors.relief, colorOf(p.colors.relief), 'relief'));
    if (body.length > 1 && !backing.length) warnings.push(t('warn.pieces').replace('{n}', String(body.length)));
  }

  // Filter degenerate slivers that would upset the slicer.
  for (const part of parts) part.poly = dropSmall(part.poly, 0.05);

  const objects: ExportObject[] = [];
  const bounds = parts.length ? parts.map((pt) => boxOf(pt.poly)).reduce((a, b) => ({ minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY), maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY) })) : { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  objects.push({ id: 'bookmark', name: t('object.bookmark'), parts: parts.filter((pt) => pt.poly.length), offset: [0, 0] });

  if (p.stand.enabled) {
    const thickness = Math.max(imageZ1, p.mode === 'frame' ? p.frame.thickness : p.mode === 'holder' ? p.holder.thickness : 0);
    const prof = standProfile(p.stand, thickness);
    const profMesh = extrude(prof, -p.stand.width / 2, p.stand.width / 2);
    // Profile is (depth, height) extruded along width: remap (x,y,z) -> (z, x, y).
    const pos = profMesh.positions;
    const remapped = new Float32Array(pos.length);
    for (let i = 0; i < pos.length; i += 3) {
      remapped[i] = pos[i + 2];
      remapped[i + 1] = pos[i] - p.stand.depth / 2;
      remapped[i + 2] = pos[i + 1];
    }
    const footprint = rect(-p.stand.width / 2, -p.stand.depth / 2, p.stand.width, p.stand.depth);
    const standPart: Part = {
      id: 'stand',
      name: t('part.stand'),
      poly: footprint,
      z0: 0,
      z1: p.stand.height,
      extruder: p.colors.base,
      color: colorOf(p.colors.base),
      mesh: { positions: remapped, indices: profMesh.indices },
      role: 'stand',
    };
    objects.push({ id: 'stand', name: t('object.stand'), parts: [standPart], offset: [0, bounds.minY - p.stand.depth / 2 - 8] });
  }

  return { objects, bounds, warnings, placed, base, fitBox, floating };
}

/** Bounding box of a traced picture in px, or null when empty. */
export function pictureBox(mp: MultiPoly): Box | null {
  if (!mp.length) return null;
  return boxOf(mp);
}

export function maskContentBox(m: Mask): Box | null {
  const b = maskBounds(m);
  return b ? { minX: b.x0, minY: b.y0, maxX: b.x1 + 1, maxY: b.y1 + 1 } : null;
}

export function ringAreaAbs(r: Pt[]): number {
  return Math.abs(ringArea(r));
}

export { union };
