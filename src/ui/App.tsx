import type { ReactElement } from 'react';
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { buildBambu3mf, buildGeneric3mf, buildStlZip, downloadBytes } from '../export/threemf';
import { FRAME_KINDS, HOLDER_KINDS } from '../geom/shapes';
import { boxH, boxW, type MultiPoly } from '../geom/types';
import { detectLang, makeT, type Lang } from '../i18n';
import { loadSourceImage } from '../model/image';
import { applyPointEdits, applyVectorEdits, assemble, buildMask, pictureBox, traceToPolys, type Assembly, type PictureInput } from '../model/pipeline';
import { defaultProject, loadProject, PRINTERS, saveProject, type Edit, type Mode, type Project, type SourceImage, type Style } from '../model/state';
import { Button, Callout, Field, Icon, Section, Seg, Slider, Toggle } from './controls';
import { FrameIcon, HolderIcon, TypeIcon } from './icons';
import { Stage2D, type Tool } from './Stage2D';
import { Stage3D } from './Stage3D';

type Step = 'picture' | 'type' | 'shape' | 'style' | 'edit' | 'export';
const STEPS: Step[] = ['picture', 'type', 'shape', 'style', 'edit', 'export'];

export function App() {
  const [lang, setLang] = useState<Lang>(detectLang);
  const t = useMemo(() => makeT(lang), [lang]);
  const [theme, setTheme] = useState<'light' | 'dark'>(() => (document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'));
  const [project, setProject] = useState<Project>(loadProject);
  const [source, setSource] = useState<SourceImage | null>(null);
  const [step, setStep] = useState<Step>('picture');
  const [view, setView] = useState<'2d' | '3d'>('2d');
  const [tool, setTool] = useState<Tool>('pan');
  const [brushMm, setBrushMm] = useState(1.2);
  const [roundMm, setRoundMm] = useState(1.5);
  const [showVertices, setShowVertices] = useState(false);
  const [showBase, setShowBase] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<{ id: number; text: string; danger?: boolean }[]>([]);
  const [fitToken, setFitToken] = useState(0);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem('bf-theme', theme);
    } catch {
      /* ignore */
    }
  }, [theme]);
  useEffect(() => {
    try {
      localStorage.setItem('bf-lang', lang);
    } catch {
      /* ignore */
    }
    document.documentElement.lang = lang;
  }, [lang]);
  useEffect(() => saveProject(project), [project]);

  const toast = useCallback((text: string, danger = false) => {
    const id = Date.now() + Math.random();
    setToasts((ts) => [...ts, { id, text, danger }]);
    setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), 3500);
  }, []);

  const update = useCallback((patch: Partial<Project> | ((p: Project) => Project)) => {
    setProject((p) => (typeof patch === 'function' ? patch(p) : { ...p, ...patch }));
  }, []);
  const set = <K extends keyof Project>(key: K, patch: Partial<Project[K]>) => update((p) => ({ ...p, [key]: { ...(p[key] as object), ...patch } }));

  const onFile = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      setBusy(true);
      setError(null);
      try {
        const src = await loadSourceImage(file);
        setSource((old) => {
          if (old) URL.revokeObjectURL(old.url);
          return src;
        });
        update((p) => ({ ...p, edits: [], placement: { ...p.placement, scale: 1, dx: 0, dy: 0, rotation: 0 }, image: { ...p.image, useAlpha: src.hasAlpha } }));
        setStep('type');
        setFitToken((n) => n + 1);
      } catch {
        setError(t('picture.badFile'));
      } finally {
        setBusy(false);
      }
    },
    [t, update],
  );

  const loadSample = useCallback(
    async (name: string) => {
      try {
        const res = await fetch(`./samples/${name}.png`);
        const blob = await res.blob();
        await onFile(new File([blob], `${name}.png`, { type: 'image/png' }));
      } catch {
        setError(t('picture.badFile'));
      }
    },
    [onFile, t],
  );

  // Paste support.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const item = Array.from(e.clipboardData?.items ?? []).find((i) => i.type.startsWith('image/'));
      const f = item?.getAsFile();
      if (f) void onFile(f);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [onFile]);

  // ---------------------------------------------------------------- pipeline
  const deferred = useDeferredValue(project);
  const printer = PRINTERS.find((p) => p.id === deferred.printerId) ?? PRINTERS[0];

  // Target picture width in mm decides the mm/px ratio used for thickening & smoothing in pixels.
  const targetWidthMm = deferred.mode === 'frame' ? Math.max(10, deferred.frame.width - 2 * deferred.frame.border) : deferred.mode === 'holder' ? deferred.holder.width * deferred.holder.fit : deferred.free.width;
  const rasterEdits = useMemo(() => deferred.edits.filter((e) => e.kind === 'paint' || e.kind === 'erase' || e.kind === 'fill'), [deferred.edits]);
  const pointEdits = useMemo(() => deferred.edits.filter((e) => e.kind === 'delete'), [deferred.edits]);
  const vectorEdits = useMemo(() => deferred.edits.filter((e) => e.kind === 'move' || e.kind === 'round'), [deferred.edits]);

  const mmPerPxGuess = source ? (targetWidthMm * deferred.placement.scale) / Math.max(1, source.width) : 1;

  const mask = useMemo(() => {
    if (!source) return null;
    return buildMask(source, { ...deferred, edits: rasterEdits }, mmPerPxGuess);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, deferred.image.threshold, deferred.image.useAlpha, deferred.image.invert, deferred.image.thicken, deferred.image.despeckle, rasterEdits, mmPerPxGuess]);

  const traced = useMemo(() => {
    if (!mask) return null;
    const smoothPx = deferred.image.smooth / mmPerPxGuess;
    const minAreaPx = 0.2 / (mmPerPxGuess * mmPerPxGuess);
    return traceToPolys(mask, Math.min(smoothPx, 6), minAreaPx);
  }, [mask, deferred.image.smooth, mmPerPxGuess]);

  const picturePx: MultiPoly | null = useMemo(() => {
    if (!traced) return null;
    const p = applyPointEdits(traced, pointEdits);
    return applyVectorEdits(p, vectorEdits, 3);
  }, [traced, pointEdits, vectorEdits]);

  const pic: PictureInput | null = useMemo(() => {
    if (!picturePx || !traced) return null;
    // Fit uses the untouched trace so deleting pieces doesn't re-scale the picture.
    const bb = pictureBox(traced);
    return bb ? { polyPx: picturePx, bboxPx: bb } : null;
  }, [picturePx, traced]);

  const assembly: Assembly = useMemo(() => assemble(deferred, pic, t), [deferred, pic, t]);
  const triangles = assembly.objects.reduce((a, o) => a + o.parts.reduce((b, p) => b + p.mesh.indices.length / 3, 0), 0);
  const partCount = assembly.objects.reduce((a, o) => a + o.parts.length, 0);
  const modelW = boxW(assembly.bounds);
  const modelH = boxH(assembly.bounds);
  const tooBig = modelW > printer.bed[0] || modelH > printer.bed[1];
  const emptyPicture = !!source && traced !== null && traced.length === 0;

  // ---------------------------------------------------------------- export
  const doExport = (kind: '3mf' | 'generic' | 'stl') => {
    try {
      const base = (source?.name.replace(/\.[^.]+$/, '') || 'bookmark') + '-' + project.mode;
      if (kind === '3mf') downloadBytes(buildBambu3mf(assembly, project, printer), `${base}.3mf`, 'model/3mf');
      else if (kind === 'generic') downloadBytes(buildGeneric3mf(assembly, printer), `${base}-generic.3mf`, 'model/3mf');
      else downloadBytes(buildStlZip(assembly), `${base}-stl.zip`, 'application/zip');
      toast(t('export.done'));
    } catch (e) {
      toast(String(e), true);
    }
  };

  const addEdit = useCallback((e: Edit) => update((p) => ({ ...p, edits: [...p.edits, e] })), [update]);
  const fileInput = useRef<HTMLInputElement>(null);

  const unit = t('unit.mm');
  const modeOpts: { value: Mode; title: string; desc: string }[] = [
    { value: 'frame', title: t('type.frame'), desc: t('type.frameDesc') },
    { value: 'holder', title: t('type.holder'), desc: t('type.holderDesc') },
    { value: 'free', title: t('type.free'), desc: t('type.freeDesc') },
  ];

  // ---------------------------------------------------------------- panels
  const picturePanel = (
    <>
      <div>
        <h2 className="panel__title">{t('step.picture')}</h2>
        <p className="panel__lead">{t('picture.hint')}</p>
      </div>
      <div
        className={'dropzone' + (dragOver ? ' dropzone--over' : '')}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          void onFile(e.dataTransfer.files[0]);
        }}
      >
        <input ref={fileInput} type="file" accept="image/*,.svg" onChange={(e) => void onFile(e.target.files?.[0])} />
        {source ? (
          <div className="artpreview">
            <img className="artpreview__img" src={source.url} alt="" />
            <div>
              <div className="artpreview__name">{source.name}</div>
              <div className="hint">{t('picture.size', { w: source.width, h: source.height })}</div>
              <div className="hint">{t('picture.replace')}</div>
            </div>
          </div>
        ) : (
          <>
            <div style={{ color: 'var(--accent)' }}>{Icon.picture}</div>
            <b>{busy ? t('picture.loading') : t('picture.drop')}</b>
            <span className="btn btn--sm">{t('picture.browse')}</span>
            <span className="hint">
              <span className="kbd">Ctrl</span>+<span className="kbd">V</span>
            </span>
          </>
        )}
      </div>
      {!source && (
        <div className="row row--wrap">
          <span className="muted">{t('picture.samples')}</span>
          {['flower', 'paw'].map((name) => (
            <Button key={name} sm ghost onClick={() => void loadSample(name)}>
              {t('picture.sample.' + name)}
            </Button>
          ))}
        </div>
      )}
      {error && <Callout kind="danger">{error}</Callout>}
      {emptyPicture && <Callout kind="danger">{t('picture.empty')}</Callout>}
      <Section title={t('picture.threshold')}>
        {source?.hasAlpha && <Toggle label={t('picture.useAlpha')} hint={t('picture.useAlphaHint')} value={project.image.useAlpha} onChange={(v) => set('image', { useAlpha: v })} />}
        <Slider label={t('picture.threshold')} value={project.image.threshold} min={1} max={254} hint={t('picture.thresholdHint')} disabled={!!source?.hasAlpha && project.image.useAlpha} onChange={(v) => set('image', { threshold: v })} />
        <Toggle label={t('picture.invert')} hint={t('picture.invertHint')} value={project.image.invert} onChange={(v) => set('image', { invert: v })} />
      </Section>
      <Section title={t('picture.thicken')}>
        <Slider label={t('picture.thicken')} value={project.image.thicken} min={0} max={3} step={0.1} unit={unit} hint={t('picture.thickenHint')} onChange={(v) => set('image', { thicken: v })} />
        <Slider label={t('picture.smooth')} value={project.image.smooth} min={0} max={1} step={0.05} unit={unit} hint={t('picture.smoothHint')} onChange={(v) => set('image', { smooth: v })} />
        <Slider label={t('picture.despeckle')} value={project.image.despeckle} min={0} max={10} step={0.1} unit={t('unit.mm2')} hint={t('picture.despeckleHint')} onChange={(v) => set('image', { despeckle: v })} />
      </Section>
      <div className="faq">
        <b>{t('faq.title')}</b>
        <span>{t('faq.1')}</span>
        <span>{t('faq.2')}</span>
        <span>{t('faq.3')}</span>
        <span>{t('faq.4')}</span>
      </div>
    </>
  );

  const typePanel = (
    <>
      <h2 className="panel__title">{t('step.type')}</h2>
      {modeOpts.map((o) => (
        <button key={o.value} type="button" className={'typecard' + (project.mode === o.value ? ' typecard--on' : '')} onClick={() => update({ mode: o.value })}>
          <TypeIcon mode={o.value} />
          <div>
            <div className="typecard__title">{o.title}</div>
            <div className="hint">{o.desc}</div>
          </div>
        </button>
      ))}
      <Section title={t('stand.title')}>
        <Toggle label={t('stand.enabled')} hint={t('stand.hint')} value={project.stand.enabled} onChange={(v) => set('stand', { enabled: v })} />
        {project.stand.enabled && (
          <>
            <Slider label={t('stand.width')} value={project.stand.width} min={20} max={200} unit={unit} onChange={(v) => set('stand', { width: v })} />
            <Slider label={t('stand.depth')} value={project.stand.depth} min={10} max={60} unit={unit} onChange={(v) => set('stand', { depth: v })} />
            <Slider label={t('stand.height')} value={project.stand.height} min={4} max={30} unit={unit} onChange={(v) => set('stand', { height: v })} />
            <Slider label={t('stand.slotDepth')} value={project.stand.slotDepth} min={2} max={20} step={0.5} unit={unit} onChange={(v) => set('stand', { slotDepth: v })} />
            <Slider label={t('stand.clearance')} value={project.stand.clearance} min={0} max={1} step={0.05} unit={unit} onChange={(v) => set('stand', { clearance: v })} />
          </>
        )}
      </Section>
    </>
  );

  const f = project.frame;
  const h = project.holder;
  const shapePanel = (
    <>
      <h2 className="panel__title">{t('step.shape')}</h2>
      {project.mode === 'frame' && (
        <>
          <Field label={t('frame.kind')}>
            <div className="tiles">
              {FRAME_KINDS.map((k) => (
                <button key={k} type="button" className={'tile' + (f.kind === k ? ' tile--on' : '')} onClick={() => set('frame', { kind: k })}>
                  <FrameIcon kind={k} />
                  {t('frame.kind.' + k)}
                </button>
              ))}
            </div>
          </Field>
          <Section title={t('frame.width')}>
            <Slider label={t('frame.width')} value={f.width} min={15} max={printer.bed[0]} unit={unit} onChange={(v) => set('frame', { width: v })} />
            {f.kind !== 'square' && f.kind !== 'circle' && <Slider label={t('frame.height')} value={f.height} min={15} max={printer.bed[1]} unit={unit} onChange={(v) => set('frame', { height: v })} />}
            <Slider label={t('frame.border')} value={f.border} min={1} max={15} step={0.5} unit={unit} onChange={(v) => set('frame', { border: v })} />
            {(f.kind === 'rounded' || f.kind === 'square') && <Slider label={t('frame.cornerRadius')} value={f.cornerRadius} min={0} max={30} step={0.5} unit={unit} onChange={(v) => set('frame', { cornerRadius: v })} />}
            {f.kind === 'corner' && (
              <>
                <Slider label={t('frame.notchW')} value={f.notchW} min={5} max={Math.max(6, f.width - 2 * f.border)} unit={unit} onChange={(v) => set('frame', { notchW: v })} />
                <Slider label={t('frame.notchH')} value={f.notchH} min={5} max={Math.max(6, f.height - 2 * f.border)} unit={unit} hint={t('frame.notchHint')} onChange={(v) => set('frame', { notchH: v })} />
              </>
            )}
          </Section>
          <Section title={t('frame.thickness')}>
            <Slider label={t('frame.thickness')} value={f.thickness} min={0.4} max={5} step={0.1} unit={unit} onChange={(v) => set('frame', { thickness: v })} />
            <Slider label={t('frame.imageThickness')} value={f.imageThickness} min={0.4} max={5} step={0.1} unit={unit} onChange={(v) => set('frame', { imageThickness: v })} />
          </Section>
          <Section title={t('frame.clip')}>
            <Seg
              value={f.clipMode}
              options={[
                { value: 'clip', label: t('frame.clip.clip') },
                { value: 'overflow', label: t('frame.clip.overflow') },
              ]}
              onChange={(v) => set('frame', { clipMode: v })}
            />
            <div className="hint">{t('frame.clipHint')}</div>
            <Toggle label={t('picture.removeFloating')} hint={t('picture.removeFloatingHint')} value={project.image.removeFloating} onChange={(v) => set('image', { removeFloating: v })} />
          </Section>
          <Section title={t('frame.hole')}>
            <Toggle label={t('frame.hole')} value={f.hole} onChange={(v) => set('frame', { hole: v })} />
            {f.hole && <Slider label={t('frame.holeDiameter')} value={f.holeDiameter} min={1.5} max={10} step={0.5} unit={unit} onChange={(v) => set('frame', { holeDiameter: v })} />}
          </Section>
        </>
      )}
      {project.mode === 'holder' && (
        <>
          <Field label={t('holder.kind')}>
            <div className="tiles">
              {HOLDER_KINDS.map((k) => (
                <button key={k} type="button" className={'tile' + (h.kind === k ? ' tile--on' : '')} onClick={() => set('holder', { kind: k })}>
                  <HolderIcon kind={k} />
                  {t('holder.kind.' + k)}
                </button>
              ))}
            </div>
          </Field>
          <Section title={t('holder.width')}>
            <Slider label={t('holder.width')} value={h.width} min={10} max={60} unit={unit} onChange={(v) => set('holder', { width: v })} />
            <Slider label={t('holder.length')} value={h.length} min={30} max={printer.bed[1] - 20} unit={unit} onChange={(v) => set('holder', { length: v })} />
            {(h.kind.startsWith('clip') || h.kind === 'plateFrame') && <Slider label={t('holder.rail')} value={h.rail} min={1.5} max={Math.max(2, h.width / 3)} step={0.5} unit={unit} hint={t('holder.railHint')} onChange={(v) => set('holder', { rail: v })} />}
            {h.kind.startsWith('clip') && <Slider label={t('holder.cap')} value={h.cap} min={3} max={40} step={0.5} unit={unit} hint={t('holder.capHint')} onChange={(v) => set('holder', { cap: v })} />}
            <Slider label={t('holder.cornerRadius')} value={h.cornerRadius} min={0} max={Math.max(1, h.width / 2)} step={0.5} unit={unit} onChange={(v) => set('holder', { cornerRadius: v })} />
          </Section>
          <Section title={t('holder.topperThickness')}>
            <Slider label={t('holder.thickness')} value={h.thickness} min={0.4} max={4} step={0.1} unit={unit} onChange={(v) => set('holder', { thickness: v })} />
            <Slider label={t('holder.topperThickness')} value={h.topperThickness} min={0.4} max={6} step={0.1} unit={unit} hint={t('holder.topperHint')} onChange={(v) => set('holder', { topperThickness: v })} />
            <Slider label={t('holder.overlap')} value={h.overlap} min={0} max={40} step={0.5} unit={unit} hint={t('holder.overlapHint')} onChange={(v) => set('holder', { overlap: v })} />
            <Slider label={t('holder.fit')} value={Math.round(h.fit * 100)} min={40} max={400} unit={t('unit.pct')} hint={t('holder.fitHint')} onChange={(v) => set('holder', { fit: v / 100 })} />
            <Toggle label={t('picture.removeFloating')} hint={t('picture.removeFloatingHint')} value={project.image.removeFloating} onChange={(v) => set('image', { removeFloating: v })} />
          </Section>
          {!h.kind.startsWith('clip') && (
            <Section title={t('holder.hole')}>
              <Toggle label={t('holder.hole')} value={h.hole} onChange={(v) => set('holder', { hole: v })} />
              {h.hole && <Slider label={t('holder.holeDiameter')} value={h.holeDiameter} min={1.5} max={10} step={0.5} unit={unit} onChange={(v) => set('holder', { holeDiameter: v })} />}
            </Section>
          )}
        </>
      )}
      {project.mode === 'free' && (
        <Section title={t('free.width')}>
          <Slider label={t('free.width')} value={project.free.width} min={10} max={printer.bed[0]} unit={unit} onChange={(v) => set('free', { width: v })} />
          <Slider label={t('free.thickness')} value={project.free.thickness} min={0.4} max={6} step={0.1} unit={unit} onChange={(v) => set('free', { thickness: v })} />
        </Section>
      )}
      <Section title={t('place.title')}>
        <Slider label={t('place.scale')} value={Math.round(project.placement.scale * 100)} min={10} max={300} unit={t('unit.pct')} onChange={(v) => set('placement', { scale: v / 100 })} />
        <Slider label={t('place.dx')} value={project.placement.dx} min={-100} max={100} step={0.5} unit={unit} onChange={(v) => set('placement', { dx: v })} />
        <Slider label={t('place.dy')} value={project.placement.dy} min={-100} max={100} step={0.5} unit={unit} onChange={(v) => set('placement', { dy: v })} />
        <Slider label={t('place.rotation')} value={project.placement.rotation} min={-180} max={180} unit={t('unit.deg')} onChange={(v) => set('placement', { rotation: v })} />
        <div className="row">
          <Toggle label={t('place.flip')} value={project.placement.flipX} onChange={(v) => set('placement', { flipX: v })} />
          <span style={{ flex: 1 }} />
          <Button sm ghost onClick={() => set('placement', { scale: 1, dx: 0, dy: 0, rotation: 0, flipX: false })}>
            {t('place.reset')}
          </Button>
        </div>
      </Section>
    </>
  );

  const styleOpts: { value: Style; title: string; desc: string }[] = [
    { value: 'lace', title: t('style.lace'), desc: t('style.laceDesc') },
    { value: 'silhouette', title: t('style.silhouette'), desc: t('style.silhouetteDesc') },
    { value: 'relief', title: t('style.relief'), desc: t('style.reliefDesc') },
  ];
  const colorSlot = (label: string, key: 'base' | 'image' | 'relief') => (
    <Field label={label}>
      <div className="swatches">
        {project.colors.palette.map((c, i) => (
          <button key={i} type="button" className={'swatch' + (project.colors[key] === i ? ' swatch--on' : '')} style={{ background: c }} title={t('style.slot', { n: i + 1 })} onClick={() => set('colors', { [key]: i } as never)} />
        ))}
      </div>
    </Field>
  );
  const stylePanel = (
    <>
      <h2 className="panel__title">{t('step.style')}</h2>
      {styleOpts.map((o) => (
        <button key={o.value} type="button" className={'typecard' + (project.style === o.value ? ' typecard--on' : '')} onClick={() => update({ style: o.value })}>
          <div>
            <div className="typecard__title">{o.title}</div>
            <div className="hint">{o.desc}</div>
          </div>
        </button>
      ))}
      {project.style === 'relief' && <Slider label={t('style.reliefHeight')} value={project.reliefHeight} min={0.2} max={3} step={0.1} unit={unit} onChange={(v) => update({ reliefHeight: v })} />}
      <Section title={t('style.colors')}>
        <div className="palette">
          {project.colors.palette.map((c, i) => (
            <label key={i} className="palette__slot">
              <span className="swatch" style={{ background: c }}>
                <input
                  type="color"
                  value={c}
                  onChange={(e) => {
                    const pal = project.colors.palette.slice();
                    pal[i] = e.target.value;
                    set('colors', { palette: pal });
                  }}
                />
              </span>
              {t('style.slot', { n: i + 1 })}
            </label>
          ))}
        </div>
        {project.mode !== 'free' && colorSlot(t('style.colorBase'), 'base')}
        {colorSlot(t('style.colorImage'), 'image')}
        {project.style === 'relief' && colorSlot(t('style.colorRelief'), 'relief')}
      </Section>
    </>
  );

  const tools: { id: Tool; label: string; icon: ReactElement }[] = [
    { id: 'pan', label: t('edit.tool.pan'), icon: Icon.pan },
    { id: 'fill', label: t('edit.tool.fill'), icon: Icon.fill },
    { id: 'delete', label: t('edit.tool.delete'), icon: Icon.del },
    { id: 'paint', label: t('edit.tool.paint'), icon: Icon.paint },
    { id: 'erase', label: t('edit.tool.erase'), icon: Icon.erase },
    { id: 'move', label: t('edit.tool.move'), icon: Icon.move },
    { id: 'round', label: t('edit.tool.round'), icon: Icon.round },
  ];
  const editPanel = (
    <>
      <div>
        <h2 className="panel__title">{t('step.edit')}</h2>
        <p className="panel__lead">{t('edit.hint')}</p>
      </div>
      <div className="tools">
        {tools.map((tl) => (
          <button key={tl.id} type="button" className={'tool' + (tool === tl.id ? ' tool--on' : '')} onClick={() => setTool(tl.id)} disabled={!source && tl.id !== 'pan'}>
            {tl.icon}
            {tl.label}
          </button>
        ))}
      </div>
      <Callout kind="info">{t('edit.tip.' + tool)}</Callout>
      {(tool === 'paint' || tool === 'erase') && <Slider label={t('edit.brush')} value={brushMm} min={0.2} max={6} step={0.1} unit={unit} onChange={setBrushMm} />}
      {tool === 'round' && <Slider label={t('edit.roundRadius')} value={roundMm} min={0.3} max={10} step={0.1} unit={unit} onChange={setRoundMm} />}
      <Toggle label={t('edit.vertices')} value={showVertices} onChange={setShowVertices} />
      <div className="row">
        <span className="muted">{t('edit.count', { n: project.edits.length })}</span>
        <span style={{ flex: 1 }} />
        <Button sm onClick={() => update((p) => ({ ...p, edits: p.edits.slice(0, -1) }))} disabled={!project.edits.length}>
          {t('edit.undo')}
        </Button>
        <Button sm ghost danger onClick={() => update({ edits: [] })} disabled={!project.edits.length}>
          {t('edit.clear')}
        </Button>
      </div>
    </>
  );

  const exportPanel = (
    <>
      <div>
        <h2 className="panel__title">{t('export.title')}</h2>
        <p className="panel__lead">{t('export.lead')}</p>
      </div>
      <Field label={t('export.printer')}>
        <select className="select" value={project.printerId} onChange={(e) => update({ printerId: e.target.value })}>
          {PRINTERS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </Field>
      {tooBig && <Callout kind="danger">{t('export.tooBig', { w: modelW.toFixed(0), h: modelH.toFixed(0), bw: printer.bed[0], bh: printer.bed[1] })}</Callout>}
      {assembly.warnings.map((w, i) => (
        <Callout key={i}>{w}</Callout>
      ))}
      <div className="hint">
        {t('view.size', { w: modelW.toFixed(1), h: modelH.toFixed(1) })} · {t('export.parts', { n: partCount })} · {t('export.tri', { n: triangles })}
      </div>
      <Button primary full disabled={!partCount} onClick={() => doExport('3mf')}>
        {Icon.download} {t('export.download3mf')}
      </Button>
      <Button full disabled={!partCount} onClick={() => doExport('generic')}>
        {Icon.download} {t('export.downloadGeneric')}
      </Button>
      <Button full disabled={!partCount} onClick={() => doExport('stl')}>
        {Icon.download} {t('export.downloadStl')}
      </Button>
      <Callout kind="info">{t('export.tip')}</Callout>
    </>
  );

  const panels: Record<Step, ReactElement> = { picture: picturePanel, type: typePanel, shape: shapePanel, style: stylePanel, edit: editPanel, export: exportPanel };

  return (
    <div className="app">
      <header className="topbar">
        <div className="logo">
          <span className="logo__mark">
            <svg width="16" height="16" viewBox="0 0 32 32">
              <path d="M11 4h10v20l-5-4-5 4z" fill="currentColor" />
            </svg>
          </span>
          {t('app.name')}
          <span className="logo__tag">{t('app.tagline')}</span>
        </div>
        <span className="topbar__spacer" />
        <Button sm ghost onClick={() => setLang(lang === 'ru' ? 'en' : 'ru')} title={t('app.lang')}>
          {lang === 'ru' ? 'EN' : 'RU'}
        </Button>
        <Button sm ghost onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} title={t('app.theme')}>
          {theme === 'dark' ? '☀' : '☾'}
        </Button>
        <Button
          sm
          ghost
          onClick={() => {
            update(defaultProject());
            toast(t('app.reset'));
          }}
        >
          {t('app.reset')}
        </Button>
      </header>
      <div className="body">
        <nav className="rail">
          {STEPS.map((s, i) => (
            <button key={s} type="button" className={'rail__btn' + (step === s ? ' rail__btn--on' : '')} onClick={() => setStep(s)}>
              <span className="rail__num">{i + 1}</span>
              {t('step.' + s)}
            </button>
          ))}
        </nav>
        <aside className="panel">{panels[step]}</aside>
        <main className="stage">
          <div className="stage__toolbar">
            <Seg
              value={view}
              options={[
                { value: '2d', label: t('view.2d') },
                { value: '3d', label: t('view.3d') },
              ]}
              onChange={setView}
            />
            {view === '2d' && (
              <>
                <Button sm onClick={() => setFitToken((n) => n + 1)}>
                  {t('view.fit')}
                </Button>
                <Toggle label={t('view.showBase')} value={showBase} onChange={setShowBase} />
              </>
            )}
            <span style={{ flex: 1 }} />
            <span className="badge">{t('view.size', { w: modelW.toFixed(1), h: modelH.toFixed(1) })}</span>
            {assembly.warnings.length > 0 && <span className="badge" style={{ color: 'var(--warn)', borderColor: 'var(--warn)' }}>{assembly.warnings[0]}</span>}
          </div>
          {view === '2d' ? (
            <Stage2D assembly={assembly} picturePx={picturePx ?? []} tool={source ? tool : 'pan'} brushMm={brushMm} roundRadiusMm={roundMm} showVertices={showVertices} showBase={showBase} onEdit={addEdit} fitToken={fitToken} />
          ) : (
            <Stage3D assembly={assembly} bed={printer.bed} />
          )}
          {!source && (
            <div className="stage__empty">
              <b>{t('view.empty')}</b>
              <span>{t('view.emptyHint')}</span>
            </div>
          )}
        </main>
      </div>
      <div className="toasts">
        {toasts.map((x) => (
          <div key={x.id} className={'toast' + (x.danger ? ' toast--danger' : '')}>
            {x.text}
          </div>
        ))}
      </div>
    </div>
  );
}
