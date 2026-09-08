import type { FrameKind, HolderKind } from '../geom/shapes';
import type { Mode } from '../model/state';

/** Small schematic icons drawn in a 44×56 box (frames) or 40×56 (types). */
export function FrameIcon({ kind }: { kind: FrameKind }) {
  const b = 4;
  switch (kind) {
    case 'rect':
      return <svg viewBox="0 0 44 56"><path d={`M2 2h40v52H2zM${2 + b} ${2 + b}h${40 - 2 * b}v${52 - 2 * b}H${2 + b}z`} /></svg>;
    case 'rounded':
      return <svg viewBox="0 0 44 56"><path d={`M8 2h28a6 6 0 016 6v40a6 6 0 01-6 6H8a6 6 0 01-6-6V8a6 6 0 016-6zM10 6h24a3 3 0 013 3v38a3 3 0 01-3 3H10a3 3 0 01-3-3V9a3 3 0 013-3z`} /></svg>;
    case 'square':
      return <svg viewBox="0 0 44 56"><path d="M4 10h36v36H4zM8 14h28v28H8z" /></svg>;
    case 'circle':
      return <svg viewBox="0 0 44 56"><path d="M22 8a20 20 0 100 40 20 20 0 000-40zm0 4a16 16 0 110 32 16 16 0 010-32z" /></svg>;
    case 'oval':
      return <svg viewBox="0 0 44 56"><path d="M22 2c11 0 20 11.6 20 26S33 54 22 54 2 42.4 2 28 11 2 22 2zm0 4C13 6 6 15.8 6 28s7 22 16 22 16-9.8 16-22S31 6 22 6z" /></svg>;
    case 'arch':
      return <svg viewBox="0 0 44 56"><path d="M2 54V22a20 20 0 0140 0v32zM6 50h32V22a16 16 0 00-32 0z" /></svg>;
    case 'hex':
      return <svg viewBox="0 0 44 56"><path d="M22 2l20 14v24L22 54 2 40V16zm0 5L6 18.5v19L22 49l16-11.5v-19z" /></svg>;
    case 'corner':
      return <svg viewBox="0 0 44 56"><path d="M2 2h40v18H20v34H2zM6 6v44h10V16h22V6z" /></svg>;
  }
}

export function HolderIcon({ kind }: { kind: HolderKind }) {
  const rail = `M6 12h32v42H6z`;
  switch (kind) {
    case 'clipSquare':
      return <svg viewBox="0 0 44 56"><path d={`M6 2h32v52H6zM10 14h6v36h-6zM28 14h6v36h-6z`} /></svg>;
    case 'clipRound':
      return <svg viewBox="0 0 44 56"><path d="M6 2h32v36a16 16 0 01-32 0zM10 14h6v30a6 6 0 01-6-6zM28 14h6v24a6 6 0 01-6 6z" /></svg>;
    case 'clipPoint':
      return <svg viewBox="0 0 44 56"><path d="M6 2h32v36L22 54 6 38zM10 14h6v26l-6-4zM28 14h6v22l-6 4z" /></svg>;
    case 'clipFrame':
      return <svg viewBox="0 0 44 56"><path d="M10 2h24a4 4 0 014 4v44a4 4 0 01-4 4H10a4 4 0 01-4-4V6a4 4 0 014-4zM10 14v34h24V14z" /></svg>;
    case 'plateRect':
      return <svg viewBox="0 0 44 56"><path d="M6 2h32v52H6z" /></svg>;
    case 'plateRoundTop':
      return <svg viewBox="0 0 44 56"><path d="M6 18a16 16 0 0132 0v36H6z" /></svg>;
    case 'platePointTop':
      return <svg viewBox="0 0 44 56"><path d="M22 2l16 14v38H6V16z" /></svg>;
    case 'plateRoundBoth':
      return <svg viewBox="0 0 44 56"><path d="M6 18a16 16 0 0132 0v20a16 16 0 01-32 0z" /></svg>;
    case 'platePointBoth':
      return <svg viewBox="0 0 44 56"><path d="M22 2l16 14v24L22 54 6 40V16z" /></svg>;
    case 'plateDecor':
      return <svg viewBox="0 0 44 56"><path d="M22 2c4 0 6 4 8 6s6 0 8 4-2 6-2 8v20L22 54 8 40V20c0-2-4-4-2-8s6-2 8-4 4-6 8-6z" /></svg>;
    case 'plateFrame':
      return <svg viewBox="0 0 44 56"><path d={`M6 2h32v52H6zM10 6v44h24V6z`} /></svg>;
    default:
      return <svg viewBox="0 0 44 56"><path d={rail} /></svg>;
  }
}

export function TypeIcon({ mode }: { mode: Mode }) {
  if (mode === 'frame')
    return <svg viewBox="0 0 40 56"><path d="M2 2h36v52H2zM6 6v44h28V6z" /><path d="M20 12c-6 6-8 12-8 20 4-4 8-6 8-10 0 4 4 6 8 10 0-8-2-14-8-20z" /></svg>;
  if (mode === 'holder')
    return <svg viewBox="0 0 40 56"><path d="M12 18h16v36H12zM16 24h3v26h-3zM21 24h3v26h-3z" /><circle cx="20" cy="12" r="10" /></svg>;
  return <svg viewBox="0 0 40 56"><path d="M20 4c8 0 14 8 14 16 0 6-4 10-6 14l4 18H8l4-18c-2-4-6-8-6-14C6 12 12 4 20 4zm0 8a6 6 0 100 12 6 6 0 000-12z" /></svg>;
}
