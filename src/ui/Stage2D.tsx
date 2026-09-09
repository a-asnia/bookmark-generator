import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MultiPoly, Pt, Box } from '../geom/types';
import { boxH, boxW, pointInPoly, pointInRing } from '../geom/types';
import type { Assembly } from '../model/pipeline';
import { nearestVertex } from '../model/pipeline';
import type { Edit } from '../model/state';

export type Tool = 'pan' | 'place' | 'fill' | 'delete' | 'paint' | 'erase' | 'move' | 'round';

export interface Stage2DProps {
  assembly: Assembly;
  /** Picture in working px (y down) after point edits, for hit tests. */
  picturePx: MultiPoly;
  tool: Tool;
  brushMm: number;
  roundRadiusMm: number;
  showVertices: boolean;
  showBase: boolean;
  onEdit: (e: Edit) => void;
  /** Drag the whole picture: delta in mm. */
  onPlace: (dx: number, dy: number) => void;
  fitToken: number;
}

interface View {
  /** mm per screen pixel */
  scale: number;
  /** mm coordinates of the screen centre */
  cx: number;
  cy: number;
}

export function pathOf(mp: MultiPoly): string {
  let d = '';
  for (const poly of mp)
    for (const ring of poly) {
      if (!ring.length) continue;
      d += `M${ring[0][0].toFixed(3)} ${ring[0][1].toFixed(3)}`;
      for (let i = 1; i < ring.length; i++) d += `L${ring[i][0].toFixed(3)} ${ring[i][1].toFixed(3)}`;
      d += 'Z';
    }
  return d;
}

export function Stage2D(props: Stage2DProps) {
  const { assembly, picturePx, tool, brushMm, roundRadiusMm, showVertices, showBase, onEdit, onPlace, fitToken } = props;
  const host = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [view, setView] = useState<View>({ scale: 0.25, cx: 0, cy: 0 });
  const drag = useRef<{ kind: 'pan' | 'brush' | 'move' | 'place'; last: Pt; pts: Pt[]; fromMm?: Pt; fromPx?: Pt } | null>(null);
  const [live, setLive] = useState<{ pts: Pt[]; kind: 'paint' | 'erase' } | { kind: 'move'; from: Pt; to: Pt } | null>(null);
  const [hover, setHover] = useState<Pt | null>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const bounds: Box = useMemo(() => {
    let b = assembly.bounds;
    if (assembly.fitBox) b = { minX: Math.min(b.minX, assembly.fitBox.minX), minY: Math.min(b.minY, assembly.fitBox.minY), maxX: Math.max(b.maxX, assembly.fitBox.maxX), maxY: Math.max(b.maxY, assembly.fitBox.maxY) };
    for (const o of assembly.objects) for (const p of o.parts) for (const poly of p.poly) for (const [x, y] of poly[0]) {
      b = { minX: Math.min(b.minX, x + o.offset[0]), minY: Math.min(b.minY, y + o.offset[1]), maxX: Math.max(b.maxX, x + o.offset[0]), maxY: Math.max(b.maxY, y + o.offset[1]) };
    }
    return b;
  }, [assembly]);

  const fit = useCallback(() => {
    const w = Math.max(10, boxW(bounds));
    const h = Math.max(10, boxH(bounds));
    const scale = Math.max(w / (size.w * 0.85), h / (size.h * 0.85));
    setView({ scale, cx: (bounds.minX + bounds.maxX) / 2, cy: (bounds.minY + bounds.maxY) / 2 });
  }, [bounds, size]);

  const fitted = useRef(false);
  useEffect(() => {
    if (!fitted.current && size.w > 0) {
      fitted.current = true;
      fit();
    }
  }, [fit, size]);
  useEffect(() => {
    if (fitToken) fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitToken]);

  const toMm = useCallback(
    (sx: number, sy: number): Pt => [view.cx + (sx - size.w / 2) * view.scale, view.cy - (sy - size.h / 2) * view.scale],
    [view, size],
  );

  const viewBox = `${view.cx - (size.w / 2) * view.scale} ${-(view.cy + (size.h / 2) * view.scale)} ${size.w * view.scale} ${size.h * view.scale}`;

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const rect = host.current!.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const [mx, my] = toMm(sx, sy);
    const f = Math.exp(e.deltaY * 0.0015);
    const scale = Math.max(0.005, Math.min(5, view.scale * f));
    // keep the point under the cursor fixed
    const cx = mx - (sx - size.w / 2) * scale;
    const cy = my + (sy - size.h / 2) * scale;
    setView({ scale, cx, cy });
  };

  const placed = assembly.placed;
  const brushPx = placed ? brushMm / placed.mmPerPx : 0;
  const vertexTolPx = placed ? (8 * view.scale) / placed.mmPerPx : 0;

  const screenPt = (e: React.PointerEvent): Pt => {
    const rect = host.current!.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  };

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const s = screenPt(e);
    const mm = toMm(s[0], s[1]);
    const isPan = tool === 'pan' || e.button === 1 || e.shiftKey || !placed;
    if (isPan) {
      drag.current = { kind: 'pan', last: s, pts: [] };
      return;
    }
    if (tool === 'place') {
      drag.current = { kind: 'place', last: s, pts: [] };
      return;
    }
    const px = placed.toPx(mm);
    if (tool === 'paint' || tool === 'erase') {
      drag.current = { kind: 'brush', last: s, pts: [px] };
      setLive({ kind: tool, pts: [mm] });
      return;
    }
    if (tool === 'fill') {
      // Only enclosed holes are fillable.
      for (const poly of picturePx)
        for (let r = 1; r < poly.length; r++)
          if (pointInRing(px, poly[r])) {
            onEdit({ kind: 'fill', p: px });
            return;
          }
      return;
    }
    if (tool === 'delete') {
      if (picturePx.some((poly) => pointInPoly(px, poly))) onEdit({ kind: 'delete', p: px });
      return;
    }
    if (tool === 'round') {
      const hit = nearestVertex(picturePx, px, vertexTolPx);
      if (hit) onEdit({ kind: 'round', p: picturePx[hit.poly][hit.ring][hit.index], radius: roundRadiusMm / placed.mmPerPx });
      return;
    }
    if (tool === 'move') {
      const hit = nearestVertex(picturePx, px, vertexTolPx);
      if (hit) {
        const v = picturePx[hit.poly][hit.ring][hit.index];
        drag.current = { kind: 'move', last: s, pts: [], fromPx: v, fromMm: placed.toMm(v) };
        setLive({ kind: 'move', from: placed.toMm(v), to: mm });
      } else drag.current = { kind: 'pan', last: s, pts: [] };
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const s = screenPt(e);
    const mm = toMm(s[0], s[1]);
    setHover(mm);
    const d = drag.current;
    if (!d) return;
    if (d.kind === 'pan') {
      setView((v) => ({ ...v, cx: v.cx - (s[0] - d.last[0]) * v.scale, cy: v.cy + (s[1] - d.last[1]) * v.scale }));
      d.last = s;
    } else if (d.kind === 'place') {
      onPlace((s[0] - d.last[0]) * view.scale, -(s[1] - d.last[1]) * view.scale);
      d.last = s;
    } else if (d.kind === 'brush' && placed) {
      d.pts.push(placed.toPx(mm));
      setLive((l) => (l && l.kind !== 'move' ? { ...l, pts: [...l.pts, mm] } : l));
    } else if (d.kind === 'move' && d.fromMm) {
      setLive({ kind: 'move', from: d.fromMm, to: mm });
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d || !placed) {
      setLive(null);
      return;
    }
    if (d.kind === 'brush') {
      onEdit({ kind: tool === 'erase' ? 'erase' : 'paint', points: d.pts, radius: brushPx });
    } else if (d.kind === 'move' && d.fromPx) {
      const s = screenPt(e);
      const mm = toMm(s[0], s[1]);
      onEdit({ kind: 'move', from: d.fromPx, to: placed.toPx(mm) });
    }
    setLive(null);
  };

  // Vertices of the picture part in mm for the move/round tools.
  const vertices = useMemo(() => {
    if (!placed || !(showVertices || tool === 'move' || tool === 'round')) return null;
    if (view.scale > 0.35) return null; // too zoomed out
    const pts: Pt[] = [];
    for (const poly of picturePx) for (const ring of poly) for (const p of ring) pts.push(placed.toMm(p));
    if (pts.length > 6000) return null;
    return pts;
  }, [placed, picturePx, showVertices, tool, view.scale]);

  const cursor = tool === 'pan' || tool === 'place' ? 'stage-cursor--grab' : tool === 'move' || tool === 'round' ? 'stage-cursor--pointer' : 'stage-cursor--crosshair';
  const parts = assembly.objects.flatMap((o) => o.parts.map((p) => ({ part: p, off: o.offset })));
  const fb = assembly.fitBox;
  const strokeW = view.scale * 1.2;

  return (
    <div ref={host} className={'stage__canvas ' + cursor} onWheel={onWheel}>
      <svg viewBox={viewBox} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={() => setHover(null)}>
        <defs>
          <pattern id="grid" width="10" height="10" patternUnits="userSpaceOnUse">
            <path d="M10 0H0V10" fill="none" stroke="var(--stage-grid)" strokeWidth={view.scale * 0.8} />
          </pattern>
        </defs>
        <g transform="scale(1,-1)">
          <rect x={view.cx - size.w * view.scale} y={-(view.cy + size.h * view.scale)} width={size.w * view.scale * 2} height={size.h * view.scale * 2} fill="url(#grid)" />
          {fb && <rect x={fb.minX} y={fb.minY} width={boxW(fb)} height={boxH(fb)} fill="none" stroke="var(--teal)" strokeDasharray={`${view.scale * 4} ${view.scale * 4}`} strokeWidth={strokeW} opacity="0.7" />}
          {parts.map(({ part, off }) =>
            !showBase && part.role === 'base' ? null : (
              <path
                key={part.id}
                d={pathOf(part.poly)}
                transform={`translate(${off[0]} ${off[1]})`}
                fill={part.color}
                fillRule="evenodd"
                fillOpacity={part.role === 'base' ? 0.55 : part.role === 'backing' ? 0.35 : part.role === 'relief' ? 0.9 : 0.92}
                stroke={part.role === 'image' ? 'var(--ink)' : 'none'}
                strokeWidth={strokeW * 0.6}
                strokeOpacity="0.5"
              />
            ),
          )}
          {assembly.floating.length > 0 && (
            <path d={pathOf(assembly.floating)} fill="var(--danger)" fillOpacity="0.12" fillRule="evenodd" stroke="var(--danger)" strokeWidth={strokeW * 0.8} strokeDasharray={`${view.scale * 3} ${view.scale * 3}`} />
          )}
          {vertices && vertices.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r={view.scale * 2.2} fill="var(--panel)" stroke="var(--accent)" strokeWidth={view.scale} />)}
          {live && live.kind !== 'move' && live.pts.length > 0 && (
            <polyline
              points={live.pts.map((p) => `${p[0]},${p[1]}`).join(' ')}
              fill="none"
              stroke={live.kind === 'paint' ? 'var(--accent)' : 'var(--danger)'}
              strokeWidth={brushMm * 2}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity="0.6"
            />
          )}
          {live && live.kind === 'move' && (
            <g>
              <line x1={live.from[0]} y1={live.from[1]} x2={live.to[0]} y2={live.to[1]} stroke="var(--accent)" strokeWidth={strokeW} />
              <circle cx={live.to[0]} cy={live.to[1]} r={view.scale * 4} fill="var(--accent)" />
            </g>
          )}
          {hover && (tool === 'paint' || tool === 'erase') && placed && (
            <circle cx={hover[0]} cy={hover[1]} r={brushMm} fill="none" stroke={tool === 'paint' ? 'var(--accent)' : 'var(--danger)'} strokeWidth={strokeW} />
          )}
        </g>
      </svg>
    </div>
  );
}
