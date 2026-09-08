/** Raster stage: turn an image into a binary mask and edit it. */
export interface Mask {
  w: number;
  h: number;
  /** 1 = material (line), 0 = empty. Row-major. */
  data: Uint8Array;
}

export function makeMask(w: number, h: number): Mask {
  return { w, h, data: new Uint8Array(w * h) };
}

export function cloneMask(m: Mask): Mask {
  return { w: m.w, h: m.h, data: new Uint8Array(m.data) };
}

export interface ThresholdOptions {
  /** 0..255. Pixels darker than this count as line when the image has no transparency. */
  threshold: number;
  /** Treat transparent pixels as empty and any opaque pixel as material, regardless of colour. */
  useAlpha: boolean;
  invert: boolean;
}

/** Does the image use its alpha channel meaningfully (has both transparent and opaque pixels)? */
export function hasTransparency(img: ImageData): boolean {
  const d = img.data;
  let sawTransparent = false;
  let sawOpaque = false;
  for (let i = 3; i < d.length; i += 4) {
    if (d[i] < 128) sawTransparent = true;
    else sawOpaque = true;
    if (sawTransparent && sawOpaque) return true;
  }
  return false;
}

export function imageToMask(img: ImageData, opt: ThresholdOptions): Mask {
  const m = makeMask(img.width, img.height);
  const d = img.data;
  const n = img.width * img.height;
  for (let i = 0; i < n; i++) {
    const a = d[i * 4 + 3];
    let on: boolean;
    if (opt.useAlpha) {
      // Line art on a transparent background: anything visible is material,
      // but a light pixel over transparency (anti-aliasing halo) is dropped.
      on = a >= 128;
    } else {
      const lum = (d[i * 4] * 299 + d[i * 4 + 1] * 587 + d[i * 4 + 2] * 114) / 1000;
      // Transparent pixels on a non-alpha image (rare) count as white.
      const eff = a < 128 ? 255 : lum;
      on = eff < opt.threshold;
    }
    if (opt.invert) on = !on;
    m.data[i] = on ? 1 : 0;
  }
  return m;
}

/** Morphological dilation by a disk of radius r (pixels). r<=0 returns a copy. */
export function dilate(m: Mask, r: number): Mask {
  if (r <= 0) return cloneMask(m);
  return diskOp(m, r, 1);
}

/** Morphological erosion by a disk of radius r (pixels). */
export function erode(m: Mask, r: number): Mask {
  if (r <= 0) return cloneMask(m);
  return diskOp(m, r, 0);
}

/**
 * Separable-ish disk operation: for each row offset dy the disk spans a
 * horizontal run [-dx, dx]; we do a horizontal max/min per offset then
 * combine rows. O(w*h*r) which is fine for r <= ~15 on 1500px masks.
 */
function diskOp(m: Mask, r: number, value: 0 | 1): Mask {
  const { w, h, data } = m;
  const ri = Math.ceil(r);
  const out = new Uint8Array(w * h);
  out.set(data);
  // Precompute horizontal extents of the disk for each dy.
  const ext: number[] = [];
  for (let dy = -ri; dy <= ri; dy++) ext.push(Math.floor(Math.sqrt(Math.max(0, r * r - dy * dy))));
  // Horizontal pass: for each dy we need a row-wise run max/min with radius ext[dy].
  // Cache row results per radius since many dy share the same extent.
  const cache = new Map<number, Uint8Array>();
  const rowPass = (rad: number): Uint8Array => {
    const hit = cache.get(rad);
    if (hit) return hit;
    const res = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      const base = y * w;
      // Prefix approach: count of 'value' pixels in window.
      let count = 0;
      const winStart = -rad;
      const winEnd = rad;
      for (let x = winStart; x <= winEnd; x++) if (x >= 0 && x < w && data[base + x] === value) count++;
      for (let x = 0; x < w; x++) {
        res[base + x] = count > 0 ? value : 1 - value;
        const outX = x - rad;
        const inX = x + rad + 1;
        if (outX >= 0 && outX < w && data[base + outX] === value) count--;
        if (inX >= 0 && inX < w && data[base + inX] === value) count++;
      }
    }
    cache.set(rad, res);
    return res;
  };
  const rows = ext.map(rowPass);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let hit = false;
      for (let k = 0; k < rows.length; k++) {
        const yy = y + k - ri;
        if (yy < 0 || yy >= h) continue;
        if (rows[k][yy * w + x] === value) {
          hit = true;
          break;
        }
      }
      out[y * w + x] = hit ? value : 1 - value;
    }
  }
  return { w, h, data: out };
}

/** Paint a filled disk into the mask. */
export function paintDisk(m: Mask, cx: number, cy: number, r: number, value: 0 | 1): void {
  const x0 = Math.max(0, Math.floor(cx - r));
  const x1 = Math.min(m.w - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const y1 = Math.min(m.h - 1, Math.ceil(cy + r));
  const r2 = r * r;
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      if (dx * dx + dy * dy <= r2) m.data[y * m.w + x] = value;
    }
}

/** Paint a thick line segment (stadium shape). */
export function paintSegment(m: Mask, ax: number, ay: number, bx: number, by: number, r: number, value: 0 | 1): void {
  const len = Math.hypot(bx - ax, by - ay);
  const steps = Math.max(1, Math.ceil(len / Math.max(0.5, r * 0.5)));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    paintDisk(m, ax + (bx - ax) * t, ay + (by - ay) * t, r, value);
  }
}

/** Flood-fill the 4-connected region containing (x,y) with the given value. Returns pixels changed. */
export function floodFill(m: Mask, x: number, y: number, value: 0 | 1): number {
  const { w, h, data } = m;
  if (x < 0 || y < 0 || x >= w || y >= h) return 0;
  const target = data[y * w + x];
  if (target === value) return 0;
  const stack: number[] = [y * w + x];
  let changed = 0;
  while (stack.length) {
    const i = stack.pop()!;
    if (data[i] !== target) continue;
    // Expand the run left and right.
    const row = Math.floor(i / w);
    let l = i;
    while (l > row * w && data[l - 1] === target) l--;
    let rgt = i;
    while (rgt < row * w + w - 1 && data[rgt + 1] === target) rgt++;
    for (let k = l; k <= rgt; k++) {
      data[k] = value;
      changed++;
      if (row > 0 && data[k - w] === target) stack.push(k - w);
      if (row < h - 1 && data[k + w] === target) stack.push(k + w);
    }
  }
  return changed;
}

/** Remove connected material components smaller than minPixels. */
export function removeSpecks(m: Mask, minPixels: number): Mask {
  const out = cloneMask(m);
  if (minPixels <= 1) return out;
  const { w, h } = out;
  const seen = new Uint8Array(w * h);
  const comp: number[] = [];
  for (let start = 0; start < w * h; start++) {
    if (out.data[start] !== 1 || seen[start]) continue;
    comp.length = 0;
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      comp.push(i);
      const x = i % w;
      const y = (i - x) / w;
      const nb = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1];
      for (const j of nb) {
        if (j >= 0 && !seen[j] && out.data[j] === 1) {
          seen[j] = 1;
          stack.push(j);
        }
      }
    }
    if (comp.length < minPixels) for (const i of comp) out.data[i] = 0;
  }
  return out;
}

/** Bounding box of material pixels, or null when the mask is empty. */
export function maskBounds(m: Mask): { x0: number; y0: number; x1: number; y1: number } | null {
  let x0 = m.w,
    y0 = m.h,
    x1 = -1,
    y1 = -1;
  for (let y = 0; y < m.h; y++)
    for (let x = 0; x < m.w; x++)
      if (m.data[y * m.w + x]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}
