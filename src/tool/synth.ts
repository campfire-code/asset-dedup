// 程序生成的示例图案（几何图形，本工具自己画的，不涉及任何他人作品）：用于测试、samples/ 和截图。

export type Pattern = 'mountain' | 'rings' | 'dots' | 'stripes' | 'sunset' | 'blocks';

export interface SynthOpts {
  /** 整体亮度增减（-255～255） */
  brightness?: number;
  /** 右下角加一个小色块（模拟加了角标 / 水印） */
  badge?: boolean;
}

const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));

function color(p: Pattern, u: number, v: number): [number, number, number] {
  switch (p) {
    case 'mountain': {
      const ridge = 0.55 + 0.18 * Math.abs(((u * 2.2) % 1) - 0.5) * 2 - 0.12 * Math.sin(u * 7);
      if (v > ridge) return [52 + 40 * v, 96 + 30 * v, 74];
      return [120 + 80 * v, 170 + 50 * v, 230];
    }
    case 'rings': {
      const r = Math.hypot(u - 0.5, v - 0.5);
      const s = Math.sin(r * 38) > 0 ? 1 : 0;
      return s ? [240, 196, 92] : [72, 54, 128];
    }
    case 'dots': {
      const du = ((u * 6) % 1) - 0.5;
      const dv = ((v * 6) % 1) - 0.5;
      return Math.hypot(du, dv) < 0.28 ? [230, 90, 110] : [250, 240, 228];
    }
    case 'stripes':
      return ((u + v) * 8) % 1 < 0.5 ? [36, 140, 150] : [226, 242, 238];
    case 'sunset': {
      const sun = Math.hypot(u - 0.62, v - 0.48) < 0.16;
      if (v > 0.68) return [40, 52, 90];
      return sun ? [255, 214, 120] : [250 - 90 * v, 140 - 60 * v, 120 + 40 * v];
    }
    case 'blocks': {
      const k = Math.floor(u * 3) + Math.floor(v * 3) * 3;
      const pal: [number, number, number][] = [[230, 57, 70], [241, 250, 238], [168, 218, 220], [69, 123, 157], [29, 53, 87], [244, 162, 97], [42, 157, 143], [233, 196, 106], [38, 70, 83]];
      return pal[k % pal.length];
    }
  }
}

/** 画一张 w×h 的 RGBA 图 */
export function synth(p: Pattern, w: number, h: number, o: SynthOpts = {}): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4);
  const b = o.brightness ?? 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = (x + 0.5) / w;
      const v = (y + 0.5) / h;
      let c = color(p, u, v);
      if (o.badge && u > 0.84 && u < 0.96 && v > 0.88 && v < 0.96) c = [255, 255, 255];
      const i = (y * w + x) * 4;
      out[i] = clamp(c[0] + b);
      out[i + 1] = clamp(c[1] + b);
      out[i + 2] = clamp(c[2] + b);
      out[i + 3] = 255;
    }
  }
  return out;
}

/** 示例文件清单：一组完全相同、一组近似（缩小、调暗、加角标）、若干不同图 */
export const SAMPLE_FILES: { file: string; pattern: Pattern; w: number; h: number; opts?: SynthOpts; copyOf?: string }[] = [
  { file: '示例-山景.png', pattern: 'mountain', w: 640, h: 480 },
  { file: '示例-山景-副本.png', pattern: 'mountain', w: 640, h: 480, copyOf: '示例-山景.png' },
  { file: '旧素材/示例-山景-再存一份.png', pattern: 'mountain', w: 640, h: 480, copyOf: '示例-山景.png' },
  { file: '示例-日落.png', pattern: 'sunset', w: 800, h: 600 },
  { file: '示例-日落-缩小.png', pattern: 'sunset', w: 400, h: 300 },
  { file: '示例-日落-调暗.png', pattern: 'sunset', w: 800, h: 600, opts: { brightness: -16 } },
  { file: '示例-日落-加角标.png', pattern: 'sunset', w: 800, h: 600, opts: { badge: true } },
  { file: '示例-波纹.png', pattern: 'rings', w: 600, h: 600 },
  { file: '示例-圆点.png', pattern: 'dots', w: 600, h: 600 },
  { file: '示例-条纹.png', pattern: 'stripes', w: 600, h: 400 },
  { file: '示例-色块.png', pattern: 'blocks', w: 600, h: 600 },
];
