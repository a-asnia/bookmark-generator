import { capsule, circle, difference, ellipse, offset, rect, roundedRect, union } from './ops';
import type { MultiPoly, Ring } from './types';

export type FrameKind = 'rect' | 'rounded' | 'square' | 'circle' | 'oval' | 'arch' | 'hex' | 'corner';
export const FRAME_KINDS: FrameKind[] = ['rect', 'rounded', 'square', 'circle', 'oval', 'arch', 'hex', 'corner'];

export interface FrameParams {
  kind: FrameKind;
  width: number;
  height: number;
  border: number;
  cornerRadius: number;
  /** corner kind: size of the notch that sits over the door/shelf corner */
  notchW: number;
  notchH: number;
  hole: boolean;
  holeDiameter: number;
}

export interface FrameGeometry {
  /** Full silhouette of the frame's outline (solid). */
  outer: MultiPoly;
  /** Area available for the picture (outer minus border). */
  inner: MultiPoly;
  /** The printed frame ring (outer minus inner) including a tassel hole. */
  ring: MultiPoly;
  width: number;
  height: number;
}

/** Full outer silhouette centred on the origin, y up. */
export function frameOutline(p: FrameParams): MultiPoly {
  const w = p.width;
  const h = p.kind === 'square' || p.kind === 'circle' ? p.width : p.height;
  const x = -w / 2;
  const y = -h / 2;
  switch (p.kind) {
    case 'rect':
      return rect(x, y, w, h);
    case 'square':
      return roundedRect(x, y, w, w, p.cornerRadius);
    case 'rounded':
      return roundedRect(x, y, w, h, p.cornerRadius);
    case 'circle':
      return circle(0, 0, w / 2, 96);
    case 'oval':
      return ellipse(0, 0, w / 2, h / 2, 96);
    case 'arch': {
      const r = w / 2;
      const ring: Ring = [];
      // bottom-left, bottom-right, then the arch from right to left over the top
      ring.push([x, y], [x + w, y]);
      const yc = y + h - r;
      const segs = 40;
      for (let i = 0; i <= segs; i++) {
        const a = (i / segs) * Math.PI;
        ring.push([r * Math.cos(a), yc + r * Math.sin(a)]);
      }
      return [[ring]];
    }
    case 'hex': {
      const ring: Ring = [
        [0, y],
        [x + w, y + h * 0.25],
        [x + w, y + h * 0.75],
        [0, y + h],
        [x, y + h * 0.75],
        [x, y + h * 0.25],
      ];
      return [[ring]];
    }
    case 'corner': {
      const nw = Math.min(p.notchW, w - p.border * 2);
      const nh = Math.min(p.notchH, h - p.border * 2);
      // Notch is cut out of the bottom-right; the L hugs a door frame corner.
      return difference(rect(x, y, w, h), rect(x + w - nw, y, nw, nh));
    }
  }
}

export function frameGeometry(p: FrameParams): FrameGeometry {
  const outer = frameOutline(p);
  const h = p.kind === 'square' || p.kind === 'circle' ? p.width : p.height;
  let inner: MultiPoly;
  let ring: MultiPoly;
  if (p.kind === 'corner') {
    // Only the two notch edges get a border; the picture may run to the outer edges.
    const nw = Math.min(p.notchW, p.width - p.border * 2);
    const nh = Math.min(p.notchH, h - p.border * 2);
    const x = -p.width / 2;
    const y = -h / 2;
    const b = p.border;
    const vertical = rect(x + p.width - nw - b, y, b, nh + b);
    const horizontal = rect(x + p.width - nw - b, y + nh, nw + b, b);
    ring = union(vertical, horizontal);
    inner = difference(outer, ring);
  } else {
    inner = offset(outer, -p.border);
    ring = difference(outer, inner);
  }
  if (p.hole && p.holeDiameter > 0) {
    const d = p.holeDiameter;
    const wall = 1.6;
    // Hole sits in the top border; add a lug when the border is too thin.
    const cy = h / 2 - Math.max(p.border / 2, d / 2 + wall);
    const lugR = d / 2 + wall;
    const lug = circle(0, cy, lugR, 40);
    ring = difference(union(ring, lug), circle(0, cy, d / 2, 32));
    inner = difference(inner, lug);
  }
  return { outer, inner, ring, width: p.width, height: h };
}

export type HolderKind =
  | 'clipSquare'
  | 'clipRound'
  | 'clipPoint'
  | 'clipFrame'
  | 'plateRect'
  | 'plateRoundTop'
  | 'platePointTop'
  | 'plateRoundBoth'
  | 'platePointBoth'
  | 'plateDecor'
  | 'plateFrame';
export const HOLDER_KINDS: HolderKind[] = [
  'clipSquare',
  'clipRound',
  'clipPoint',
  'clipFrame',
  'plateRect',
  'plateRoundTop',
  'platePointTop',
  'plateRoundBoth',
  'platePointBoth',
  'plateDecor',
  'plateFrame',
];

export interface HolderParams {
  kind: HolderKind;
  width: number;
  length: number;
  /** Rails (side bars) of a clip, or the border of a frame plate. */
  rail: number;
  /** Solid cap at the top of a clip where the topper sits. */
  cap: number;
  cornerRadius: number;
  hole: boolean;
  holeDiameter: number;
}

export function isClip(kind: HolderKind): boolean {
  return kind.startsWith('clip');
}

/** Holder silhouette with its top edge at y=0, centred on x=0, extending to y=-length. */
export function holderShape(p: HolderParams): MultiPoly {
  const w = p.width;
  const L = p.length;
  const x = -w / 2;
  const r = Math.min(p.cornerRadius, w / 2, L / 2);
  const bottomTip = (kind: 'square' | 'round' | 'point'): MultiPoly => {
    if (kind === 'square') return roundedRect(x, -L, w, L, r);
    if (kind === 'round') {
      const body = roundedRect(x, -L + w / 2, w, L - w / 2, r);
      return union(body, circle(0, -L + w / 2, w / 2, 48));
    }
    // point: rectangle plus a triangle tip
    const tip = w * 0.5;
    const body = roundedRect(x, -L + tip, w, L - tip, r);
    const tri: MultiPoly = [
      [
        [
          [x, -L + tip + 0.01],
          [x + w, -L + tip + 0.01],
          [0, -L],
        ],
      ],
    ];
    return union(body, tri);
  };
  let shape: MultiPoly;
  switch (p.kind) {
    case 'clipSquare':
    case 'clipRound':
    case 'clipPoint': {
      const outer = bottomTip(p.kind === 'clipSquare' ? 'square' : p.kind === 'clipRound' ? 'round' : 'point');
      const rail = p.rail;
      const tongue = Math.max(2, w - 2 * rail - 2 * rail); // tongue width equals the slot rails by default
      const slotW = (w - 2 * rail - tongue) / 2;
      const bottomRail = p.kind === 'clipSquare' ? rail : w * 0.5;
      const y1 = -p.cap;
      const y0 = -L + bottomRail;
      const slots = union(
        roundedRect(x + rail, y0, slotW, y1 - y0, Math.min(slotW / 2, 1.5)),
        roundedRect(x + w - rail - slotW, y0, slotW, y1 - y0, Math.min(slotW / 2, 1.5)),
      );
      shape = difference(outer, slots);
      break;
    }
    case 'clipFrame': {
      const outer = roundedRect(x, -L, w, L, r);
      const y1 = -p.cap;
      const y0 = -L + p.rail;
      const hole = roundedRect(x + p.rail, y0, w - 2 * p.rail, y1 - y0, Math.max(0, r - p.rail));
      shape = difference(outer, hole);
      break;
    }
    case 'plateRect':
      shape = roundedRect(x, -L, w, L, r);
      break;
    case 'plateRoundTop':
      shape = union(roundedRect(x, -L, w, L - w / 2, r), circle(0, -w / 2, w / 2, 48));
      break;
    case 'platePointTop': {
      const tip = w * 0.45;
      shape = union(roundedRect(x, -L, w, L - tip, r), [
        [
          [
            [x, -tip - 0.01],
            [0, 0],
            [x + w, -tip - 0.01],
          ],
        ],
      ]);
      break;
    }
    case 'plateRoundBoth':
      shape = capsule(x, -L, w, L);
      break;
    case 'platePointBoth': {
      const tip = w * 0.4;
      shape = union(
        roundedRect(x, -L + tip, w, L - 2 * tip, r),
        [
          [
            [
              [x, -tip - 0.01],
              [0, 0],
              [x + w, -tip - 0.01],
            ],
          ],
        ],
        [
          [
            [
              [x + w, -L + tip + 0.01],
              [0, -L],
              [x, -L + tip + 0.01],
            ],
          ],
        ],
      );
      break;
    }
    case 'plateDecor': {
      // Scalloped top: three bumps.
      const tip = w * 0.4;
      const body = roundedRect(x, -L + tip, w, L - 2 * tip, r);
      const bumps = union(
        circle(-w / 3, -tip, w / 6, 32),
        circle(0, -tip, w / 4, 40),
        circle(w / 3, -tip, w / 6, 32),
        circle(0, -w / 4 - tip * 0.1, w / 4, 40),
      );
      const bottom: MultiPoly = [
        [
          [
            [x + w, -L + tip + 0.01],
            [0, -L],
            [x, -L + tip + 0.01],
          ],
        ],
      ];
      shape = union(body, bumps, bottom);
      break;
    }
    case 'plateFrame': {
      const outer = roundedRect(x, -L, w, L, r);
      shape = difference(outer, offset(outer, -p.rail));
      break;
    }
  }
  if (p.hole && p.holeDiameter > 0 && !isClip(p.kind)) {
    const d = p.holeDiameter;
    const cy = -(d / 2 + 2.5);
    shape = difference(shape, circle(0, cy, d / 2, 32));
  }
  return shape;
}

export interface StandParams {
  enabled: boolean;
  width: number; // along the bookmark width (X)
  depth: number; // front-to-back (Y)
  height: number; // Z
  slotDepth: number;
  clearance: number;
}

/** Side profile of the stand in (depth, height) coordinates, with a slot for the given thickness. */
export function standProfile(p: StandParams, thickness: number): MultiPoly {
  const slotW = thickness + p.clearance;
  const body = roundedRect(0, 0, p.depth, p.height, Math.min(1.5, p.height / 3));
  const slot = rect(p.depth / 2 - slotW / 2, p.height - p.slotDepth, slotW, p.slotDepth + 1);
  return difference(body, slot);
}
