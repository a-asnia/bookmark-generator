import { hasTransparency } from '../geom/bitmap';
import type { SourceImage } from './state';
import { MAX_WORK_PX } from './pipeline';

/** Decode any browser-supported image (including SVG) into working-resolution ImageData. */
export async function loadSourceImage(file: File): Promise<SourceImage> {
  const url = URL.createObjectURL(file);
  try {
    const img = await decode(url, file);
    let w = img.naturalWidth || img.width;
    let h = img.naturalHeight || img.height;
    if (!w || !h) throw new Error('empty image');
    const isSvg = file.type === 'image/svg+xml' || /\.svg$/i.test(file.name);
    // SVGs get rendered at full working resolution for crisp edges.
    const long = Math.max(w, h);
    const scale = isSvg ? MAX_WORK_PX / long : Math.min(1, MAX_WORK_PX / long);
    w = Math.max(1, Math.round(w * scale));
    h = Math.max(1, Math.round(h * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('no canvas');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h);
    return { name: file.name, width: w, height: h, data, hasAlpha: hasTransparency(data), url };
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
}

function decode(url: string, file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      // SVGs without explicit size report 0; give them a default viewport.
      if ((!img.naturalWidth || !img.naturalHeight) && /svg/i.test(file.type)) {
        img.width = 1000;
        img.height = 1000;
      }
      resolve(img);
    };
    img.onerror = () => reject(new Error('decode failed'));
    img.src = url;
  });
}
