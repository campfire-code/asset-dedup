// 用页面里的画布解码图片（兼容 macOS 与 Windows 的系统网页引擎；不用 OffscreenCanvas）。
import type { Decoded } from './flow';

export const SIDE = 32;
const THUMB = 240;

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  return [c, g] as const;
}

/** 解码：原图尺寸、32×32 RGBA（先缩到 256 再缩到 32，减少锯齿）、最长边 240 的 JPEG 缩略图 */
export async function decodeImage(bytes: Uint8Array): Promise<Decoded> {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart]));
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode().catch(() => {
      throw new Error('无法识别这张图片，可能已损坏或格式不受支持');
    });
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (!w || !h) throw new Error('图片尺寸为 0');
    const [mid, mg] = canvas(256, 256);
    mg.fillStyle = '#FFFFFF';
    mg.fillRect(0, 0, 256, 256);
    mg.drawImage(img, 0, 0, 256, 256);
    const [, sg] = canvas(SIDE, SIDE);
    sg.drawImage(mid, 0, 0, SIDE, SIDE);
    const rgba = sg.getImageData(0, 0, SIDE, SIDE).data;
    const k = Math.min(1, THUMB / Math.max(w, h));
    const [tc, tg] = canvas(Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k)));
    tg.fillStyle = '#FFFFFF';
    tg.fillRect(0, 0, tc.width, tc.height);
    tg.drawImage(img, 0, 0, tc.width, tc.height);
    return { width: w, height: h, rgba, side: SIDE, thumb: tc.toDataURL('image/jpeg', 0.8) };
  } finally {
    URL.revokeObjectURL(url);
  }
}
