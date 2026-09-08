import { zipSync, strToU8 } from 'fflate';
import type { Mesh } from '../geom/extrude';
import type { Assembly, ExportObject, Part } from '../model/pipeline';
import type { PrinterPreset, Project } from '../model/state';
import baseProject from './bambu_a1mini_project.json';

const CORE_NS = 'http://schemas.microsoft.com/3dmanufacturing/core/2015/02';
const PROD_NS = 'http://schemas.microsoft.com/3dmanufacturing/production/2015/06';
const BBL_NS = 'http://schemas.bambulab.com/package/2021';

function uuid(seed: number, salt: number): string {
  const h = (seed * 2654435761 + salt * 40503) >>> 0;
  const hex = (h.toString(16) + '0000000000000000').slice(0, 12);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${'000'}-8000-${(salt * 7919 + seed).toString(16).padStart(12, '0').slice(0, 12)}`;
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(4).replace(/\.?0+$/, '');
}

function meshXml(mesh: Mesh): string {
  const out: string[] = ['    <vertices>\n'];
  const p = mesh.positions;
  for (let i = 0; i < p.length; i += 3) out.push(`     <vertex x="${fmt(p[i])}" y="${fmt(p[i + 1])}" z="${fmt(p[i + 2])}"/>\n`);
  out.push('    </vertices>\n    <triangles>\n');
  const t = mesh.indices;
  for (let i = 0; i < t.length; i += 3) out.push(`     <triangle v1="${t[i]}" v2="${t[i + 1]}" v3="${t[i + 2]}"/>\n`);
  out.push('    </triangles>\n');
  return out.join('');
}

function transformStr(dx: number, dy: number, dz: number): string {
  return `1 0 0 0 1 0 0 0 1 ${fmt(dx)} ${fmt(dy)} ${fmt(dz)}`;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

interface Layout {
  /** plate offset per object id */
  offsets: Map<string, [number, number]>;
}

/** Centre the bookmark on the bed and keep the stand's relative offset. */
function layout(asm: Assembly, bed: [number, number]): Layout {
  const offsets = new Map<string, [number, number]>();
  const b = asm.bounds;
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  const base: [number, number] = [bed[0] / 2 - cx, bed[1] / 2 - cy];
  for (const o of asm.objects) offsets.set(o.id, [base[0] + o.offset[0], base[1] + o.offset[1]]);
  return { offsets };
}

/**
 * Bambu Studio / Orca flavoured 3MF: one object per printed thing, parts as
 * components with per-part extruders, and a project config carrying the
 * printer profile and filament colours.
 */
export function buildBambu3mf(asm: Assembly, project: Project, printer: PrinterPreset): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  const lay = layout(asm, printer.bed);
  let nextId = 1;
  const partFiles: { object: ExportObject; part: Part; id: number; file: string }[] = [];
  const objectIds = new Map<string, number>();
  const rels: string[] = [];
  const resources: string[] = [];
  const build: string[] = [];
  const settings: string[] = [];
  const instances: string[] = [];
  const assembles: string[] = [];

  for (const obj of asm.objects) {
    const compIds: number[] = [];
    const partEntries: string[] = [];
    for (const part of obj.parts) {
      const id = nextId++;
      const file = `/3D/Objects/object_${id}.model`;
      partFiles.push({ object: obj, part, id, file });
      compIds.push(id);
      files[file.slice(1)] = strToU8(
        `<?xml version="1.0" encoding="UTF-8"?>\n` +
          `<model unit="millimeter" xml:lang="en-US" xmlns="${CORE_NS}" xmlns:BambuStudio="${BBL_NS}" xmlns:p="${PROD_NS}" requiredextensions="p">\n` +
          ` <metadata name="BambuStudio:3mfVersion">1</metadata>\n <resources>\n` +
          `  <object id="${id}" p:UUID="${uuid(id, 1)}" type="model">\n   <mesh>\n${meshXml(part.mesh)}   </mesh>\n  </object>\n` +
          ` </resources>\n <build/>\n</model>\n`,
      );
      rels.push(` <Relationship Target="${file}" Id="rel-${id}" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>`);
      partEntries.push(
        `    <part id="${id}" subtype="normal_part">\n` +
          `      <metadata key="name" value="${esc(part.name)}"/>\n` +
          `      <metadata key="matrix" value="1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 1"/>\n` +
          `      <metadata key="extruder" value="${part.extruder + 1}"/>\n` +
          `      <metadata key="source_object_id" value="0"/>\n      <metadata key="source_volume_id" value="0"/>\n` +
          `      <mesh_stat face_count="${part.mesh.indices.length / 3}" edges_fixed="0" degenerate_facets="0" facets_removed="0" facets_reversed="0" backwards_edges="0"/>\n` +
          `    </part>\n`,
      );
    }
    const objId = nextId++;
    objectIds.set(obj.id, objId);
    resources.push(
      `  <object id="${objId}" p:UUID="${uuid(objId, 2)}" type="model">\n   <components>\n` +
        compIds
          .map((cid) => `    <component p:path="/3D/Objects/object_${cid}.model" objectid="${cid}" p:UUID="${uuid(cid, 3)}" transform="1 0 0 0 1 0 0 0 1 0 0 0"/>`)
          .join('\n') +
        `\n   </components>\n  </object>`,
    );
    const off = lay.offsets.get(obj.id) ?? [0, 0];
    build.push(`  <item objectid="${objId}" p:UUID="${uuid(objId, 4)}" transform="${transformStr(off[0], off[1], 0)}" printable="1"/>`);
    settings.push(
      `  <object id="${objId}">\n    <metadata key="name" value="${esc(obj.name)}"/>\n    <metadata key="extruder" value="${(obj.parts[0]?.extruder ?? 0) + 1}"/>\n` +
        `    <metadata face_count="${obj.parts.reduce((a, pt) => a + pt.mesh.indices.length / 3, 0)}"/>\n` +
        partEntries.join('') +
        `  </object>\n`,
    );
    instances.push(
      `    <model_instance>\n      <metadata key="object_id" value="${objId}"/>\n      <metadata key="instance_id" value="0"/>\n      <metadata key="identify_id" value="${100 + objId}"/>\n    </model_instance>\n`,
    );
    assembles.push(`    <assemble_item object_id="${objId}" instance_id="0" transform="${transformStr(off[0], off[1], 0)}" offset="0 0 0"/>\n`);
  }

  const today = new Date().toISOString().slice(0, 10);
  files['3D/3dmodel.model'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<model unit="millimeter" xml:lang="en-US" xmlns="${CORE_NS}" xmlns:p="${PROD_NS}" requiredextensions="p" xmlns:BambuStudio="${BBL_NS}">\n` +
      ` <metadata name="Application">BambuStudio-02.05.00.66</metadata>\n <metadata name="BambuStudio:3mfVersion">1</metadata>\n` +
      ` <metadata name="Copyright"/>\n <metadata name="CreationDate">${today}</metadata>\n <metadata name="Description">Bookmark Forge export</metadata>\n` +
      ` <metadata name="Designer"/>\n <metadata name="License"/>\n <metadata name="ModificationDate">${today}</metadata>\n <metadata name="Title">Bookmark</metadata>\n` +
      ` <resources>\n${resources.join('\n')}\n </resources>\n <build p:UUID="${uuid(99, 5)}">\n${build.join('\n')}\n </build>\n</model>\n`,
  );
  files['3D/_rels/3dmodel.model.rels'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n${rels.join('\n')}\n</Relationships>`,
  );
  files['_rels/.rels'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n` +
      ` <Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>\n</Relationships>`,
  );
  files['[Content_Types].xml'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n` +
      ` <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n` +
      ` <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>\n` +
      ` <Default Extension="png" ContentType="image/png"/>\n</Types>`,
  );
  files['Metadata/model_settings.config'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8"?>\n<config>\n${settings.join('')}  <plate>\n    <metadata key="plater_id" value="1"/>\n    <metadata key="plater_name" value=""/>\n` +
      `    <metadata key="locked" value="false"/>\n    <metadata key="filament_map_mode" value="Auto For Flush"/>\n    <metadata key="filament_maps" value="1 1 1 1"/>\n` +
      `${instances.join('')}  </plate>\n  <assemble>\n${assembles.join('')}  </assemble>\n</config>\n`,
  );
  files['Metadata/project_settings.config'] = strToU8(JSON.stringify(projectSettings(project, printer), null, 4));
  files['Metadata/slice_info.config'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8"?>\n<config>\n  <header>\n    <header_item key="X-BBL-Client-Type" value="slicer"/>\n    <header_item key="X-BBL-Client-Version" value="02.05.00.66"/>\n  </header>\n</config>\n`,
  );
  files['Metadata/cut_information.xml'] = strToU8(
    `<?xml version="1.0" encoding="utf-8"?>\n<objects>\n${[...objectIds.values()].map((id) => ` <object id="${id}">\n  <cut_id id="0" check_sum="1" connectors_cnt="0"/>\n </object>\n`).join('')}</objects>\n`,
  );
  return zipSync(files, { level: 6 });
}

function projectSettings(project: Project, printer: PrinterPreset): Record<string, unknown> {
  const cfg: Record<string, unknown> = { ...(baseProject as Record<string, unknown>) };
  const n = 4;
  const colours = Array.from({ length: n }, (_, i) => project.colors.palette[i] ?? '#FFFFFF');
  cfg.filament_colour = colours.map((c) => c.toUpperCase());
  cfg.filament_settings_id = Array(n).fill(printer.bambuFilamentId ?? 'Bambu PLA Basic @BBL A1M');
  cfg.default_filament_profile = [printer.bambuFilamentId ?? 'Bambu PLA Basic @BBL A1M'];
  cfg.printer_settings_id = printer.bambuPrinterSettingsId ?? cfg.printer_settings_id;
  cfg.print_settings_id = printer.bambuPrintSettingsId ?? cfg.print_settings_id;
  cfg.default_print_profile = cfg.print_settings_id;
  cfg.printer_model = printer.bambuPrinter ?? cfg.printer_model;
  cfg.print_compatible_printers = [cfg.printer_settings_id];
  cfg.printable_area = ['0x0', `${printer.bed[0]}x0`, `${printer.bed[0]}x${printer.bed[1]}`, `0x${printer.bed[1]}`];
  cfg.printable_height = printer.bed[0] >= 350 ? 325 : printer.bed[0] >= 256 ? 250 : 180;
  // Flat parts: full solid, more walls for strength.
  cfg.sparse_infill_density = '100%';
  cfg.wall_loops = '3';
  cfg.top_shell_layers = '4';
  cfg.bottom_shell_layers = '3';
  cfg.enable_support = '0';
  cfg.brim_type = 'no_brim';
  return cfg;
}

/** Plain 3MF understood by PrusaSlicer, Cura and others: every part as a separate object. */
export function buildGeneric3mf(asm: Assembly, printer: PrinterPreset): Uint8Array {
  const lay = layout(asm, printer.bed);
  const resources: string[] = [];
  const build: string[] = [];
  let id = 1;
  for (const obj of asm.objects) {
    const off = lay.offsets.get(obj.id) ?? [0, 0];
    for (const part of obj.parts) {
      resources.push(`  <object id="${id}" name="${esc(obj.name + ' - ' + part.name)}" type="model">\n   <mesh>\n${meshXml(part.mesh)}   </mesh>\n  </object>`);
      build.push(`  <item objectid="${id}" transform="${transformStr(off[0], off[1], 0)}"/>`);
      id++;
    }
  }
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n` +
        ` <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n` +
        ` <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>\n</Types>`,
    ),
    '_rels/.rels': strToU8(
      `<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n` +
        ` <Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>\n</Relationships>`,
    ),
    '3D/3dmodel.model': strToU8(
      `<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" xmlns="${CORE_NS}">\n <resources>\n${resources.join('\n')}\n </resources>\n <build>\n${build.join('\n')}\n </build>\n</model>\n`,
    ),
  };
  return zipSync(files, { level: 6 });
}

export function buildStl(mesh: Mesh, offset: [number, number] = [0, 0]): Uint8Array {
  const tri = mesh.indices.length / 3;
  const buf = new ArrayBuffer(84 + tri * 50);
  const dv = new DataView(buf);
  const header = 'Bookmark Forge binary STL';
  for (let i = 0; i < 80; i++) dv.setUint8(i, i < header.length ? header.charCodeAt(i) : 0);
  dv.setUint32(80, tri, true);
  const p = mesh.positions;
  let o = 84;
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const a = mesh.indices[t] * 3;
    const b = mesh.indices[t + 1] * 3;
    const c = mesh.indices[t + 2] * 3;
    const ux = p[b] - p[a];
    const uy = p[b + 1] - p[a + 1];
    const uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a];
    const vy = p[c + 1] - p[a + 1];
    const vz = p[c + 2] - p[a + 2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    dv.setFloat32(o, nx, true);
    dv.setFloat32(o + 4, ny, true);
    dv.setFloat32(o + 8, nz, true);
    o += 12;
    for (const idx of [a, b, c]) {
      dv.setFloat32(o, p[idx] + offset[0], true);
      dv.setFloat32(o + 4, p[idx + 1] + offset[1], true);
      dv.setFloat32(o + 8, p[idx + 2], true);
      o += 12;
    }
    dv.setUint16(o, 0, true);
    o += 2;
  }
  return new Uint8Array(buf);
}

export function buildStlZip(asm: Assembly): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  for (const obj of asm.objects)
    for (const part of obj.parts) files[`${safe(obj.name)}-${safe(part.name)}.stl`] = buildStl(part.mesh, obj.offset);
  return zipSync(files, { level: 1 });
}

function safe(s: string): string {
  return s.replace(/[^\p{L}\p{N}_-]+/gu, '_');
}

export function downloadBytes(bytes: Uint8Array, filename: string, mime = 'application/octet-stream'): void {
  const blob = new Blob([bytes as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
