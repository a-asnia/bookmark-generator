import type { FrameKind, HolderKind } from '../geom/shapes';
import type { Pt } from '../geom/types';

export type Mode = 'frame' | 'holder' | 'free';
export type Style = 'lace' | 'silhouette' | 'relief';
export type ClipMode = 'clip' | 'overflow';

/** Raster brush stroke or vector correction. All coordinates are in working-image pixels. */
export type Edit =
  | { kind: 'paint' | 'erase'; points: Pt[]; radius: number }
  | { kind: 'fill'; p: Pt }
  | { kind: 'delete'; p: Pt }
  | { kind: 'move'; from: Pt; to: Pt }
  | { kind: 'round'; p: Pt; radius: number };

export interface ImageSettings {
  threshold: number;
  useAlpha: boolean;
  invert: boolean;
  /** Global line thickening, mm. */
  thicken: number;
  /** Corner smoothing tolerance, mm. */
  smooth: number;
  /** Drop specks smaller than this, mm². */
  despeckle: number;
  /** Drop picture pieces that don't touch the frame or holder. */
  removeFloating: boolean;
}

export interface Placement {
  /** 1 = auto fit. */
  scale: number;
  dx: number;
  dy: number;
  rotation: number;
  flipX: boolean;
}

export interface FrameSettings {
  kind: FrameKind;
  width: number;
  height: number;
  border: number;
  cornerRadius: number;
  notchW: number;
  notchH: number;
  hole: boolean;
  holeDiameter: number;
  thickness: number;
  imageThickness: number;
  clipMode: ClipMode;
}

export interface HolderSettings {
  kind: HolderKind;
  width: number;
  length: number;
  rail: number;
  cap: number;
  cornerRadius: number;
  hole: boolean;
  holeDiameter: number;
  thickness: number;
  topperThickness: number;
  /** How far the topper reaches down over the holder, mm. */
  overlap: number;
  /** Topper width relative to holder width (auto fit). */
  fit: number;
}

export interface FreeSettings {
  width: number;
  thickness: number;
}

export type BackingShape = 'frame' | 'silhouette' | 'plate';

/** Solid plate under the picture so the lines print as relief on a base. */
export interface BackingSettings {
  enabled: boolean;
  shape: BackingShape;
  thickness: number;
  /** Margin around the picture for the 'plate' shape, mm. */
  margin: number;
  cornerRadius: number;
}

export interface StandSettings {
  enabled: boolean;
  width: number;
  depth: number;
  height: number;
  slotDepth: number;
  clearance: number;
}

export interface ColorSettings {
  palette: string[];
  base: number; // extruder index (0-based) for frame / holder / stand
  image: number;
  relief: number;
  backing: number;
}

export interface Project {
  mode: Mode;
  style: Style;
  reliefHeight: number;
  image: ImageSettings;
  edits: Edit[];
  placement: Placement;
  frame: FrameSettings;
  holder: HolderSettings;
  free: FreeSettings;
  stand: StandSettings;
  backing: BackingSettings;
  colors: ColorSettings;
  printerId: string;
}

export interface SourceImage {
  name: string;
  /** Working-resolution pixels. */
  width: number;
  height: number;
  data: ImageData;
  hasAlpha: boolean;
  /** Preview URL of the original upload. */
  url: string;
}

export interface PrinterPreset {
  id: string;
  name: string;
  bed: [number, number];
  bambuPrinter?: string;
  bambuPrinterSettingsId?: string;
  bambuPrintSettingsId?: string;
  bambuFilamentId?: string;
}

export const PRINTERS: PrinterPreset[] = [
  {
    id: 'a1mini',
    name: 'Bambu Lab A1 mini (180 × 180)',
    bed: [180, 180],
    bambuPrinter: 'Bambu Lab A1 mini',
    bambuPrinterSettingsId: 'Bambu Lab A1 mini 0.4 nozzle',
    bambuPrintSettingsId: '0.20mm Standard @BBL A1M',
    bambuFilamentId: 'Bambu PLA Basic @BBL A1M',
  },
  {
    id: 'a1',
    name: 'Bambu Lab A1 (256 × 256)',
    bed: [256, 256],
    bambuPrinter: 'Bambu Lab A1',
    bambuPrinterSettingsId: 'Bambu Lab A1 0.4 nozzle',
    bambuPrintSettingsId: '0.20mm Standard @BBL A1',
    bambuFilamentId: 'Bambu PLA Basic @BBL A1',
  },
  {
    id: 'p1s',
    name: 'Bambu Lab P1S / P1P (256 × 256)',
    bed: [256, 256],
    bambuPrinter: 'Bambu Lab P1S',
    bambuPrinterSettingsId: 'Bambu Lab P1S 0.4 nozzle',
    bambuPrintSettingsId: '0.20mm Standard @BBL P1P',
    bambuFilamentId: 'Bambu PLA Basic @BBL P1P',
  },
  {
    id: 'x1c',
    name: 'Bambu Lab X1 / X1C (256 × 256)',
    bed: [256, 256],
    bambuPrinter: 'Bambu Lab X1 Carbon',
    bambuPrinterSettingsId: 'Bambu Lab X1 Carbon 0.4 nozzle',
    bambuPrintSettingsId: '0.20mm Standard @BBL X1C',
    bambuFilamentId: 'Bambu PLA Basic @BBL X1C',
  },
  {
    id: 'h2d',
    name: 'Bambu Lab H2D (350 × 320)',
    bed: [350, 320],
    bambuPrinter: 'Bambu Lab H2D',
    bambuPrinterSettingsId: 'Bambu Lab H2D 0.4 nozzle',
    bambuPrintSettingsId: '0.20mm Standard @BBL H2D',
    bambuFilamentId: 'Bambu PLA Basic @BBL H2D',
  },
  { id: 'generic220', name: 'Generic 220 × 220', bed: [220, 220] },
  { id: 'generic300', name: 'Generic 300 × 300', bed: [300, 300] },
];

export const DEFAULT_PALETTE = ['#1f1c17', '#f26b1d', '#157f7a', '#fffdf9'];

export function defaultProject(): Project {
  return {
    mode: 'frame',
    style: 'lace',
    reliefHeight: 0.6,
    image: {
      threshold: 160,
      useAlpha: true,
      invert: false,
      thicken: 0,
      smooth: 0.15,
      despeckle: 0.5,
      removeFloating: true,
    },
    edits: [],
    placement: { scale: 1, dx: 0, dy: 0, rotation: 0, flipX: false },
    frame: {
      kind: 'rounded',
      width: 40,
      height: 140,
      border: 3,
      cornerRadius: 4,
      notchW: 60,
      notchH: 60,
      hole: false,
      holeDiameter: 4,
      thickness: 1.2,
      imageThickness: 1.2,
      clipMode: 'clip',
    },
    holder: {
      kind: 'clipRound',
      width: 22,
      length: 75,
      rail: 3,
      cap: 10,
      cornerRadius: 3,
      hole: false,
      holeDiameter: 4,
      thickness: 1,
      topperThickness: 1.6,
      overlap: 8,
      fit: 1.4,
    },
    free: { width: 100, thickness: 1.5 },
    stand: { enabled: false, width: 60, depth: 20, height: 8, slotDepth: 5, clearance: 0.3 },
    backing: { enabled: false, shape: 'frame', thickness: 0.8, margin: 2, cornerRadius: 3 },
    colors: { palette: DEFAULT_PALETTE.slice(), base: 0, image: 1, relief: 2, backing: 3 },
    printerId: 'a1mini',
  };
}

export const PROJECT_STORAGE_KEY = 'bf-project-v1';

export function loadProject(): Project {
  const base = defaultProject();
  try {
    const raw = localStorage.getItem(PROJECT_STORAGE_KEY);
    if (!raw) return base;
    const saved = JSON.parse(raw) as Partial<Project>;
    return {
      ...base,
      ...saved,
      image: { ...base.image, ...(saved.image ?? {}) },
      placement: { ...base.placement, ...(saved.placement ?? {}) },
      frame: { ...base.frame, ...(saved.frame ?? {}) },
      holder: { ...base.holder, ...(saved.holder ?? {}) },
      free: { ...base.free, ...(saved.free ?? {}) },
      stand: { ...base.stand, ...(saved.stand ?? {}) },
      backing: { ...base.backing, ...(saved.backing ?? {}) },
      colors: { ...base.colors, ...(saved.colors ?? {}) },
      edits: [],
    };
  } catch {
    return base;
  }
}

export function saveProject(p: Project): void {
  try {
    const { edits: _edits, ...rest } = p;
    localStorage.setItem(PROJECT_STORAGE_KEY, JSON.stringify(rest));
  } catch {
    /* ignore quota / private mode */
  }
}
