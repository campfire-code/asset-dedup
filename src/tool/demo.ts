// 预览页与截图用的示例状态：图案由 synth.ts 程序生成（本工具自己画的几何图形），文件名都标了「示例」。
import { fingerprint, groupAssets, type Asset } from './core';
import { synth, type Pattern, type SynthOpts } from './synth';

// check-zh: 忽略（示例路径，只用于预览页）
const ROOT = '/Users/小林/图片/示例素材库';
const LIST: [string, Pattern, number, number, number, SynthOpts?, string?][] = [
  ['示例-山景-封面.jpg', 'mountain', 1920, 1080, 412_000, undefined, 'm'],
  ['示例-山景-封面-副本.jpg', 'mountain', 1920, 1080, 412_000, undefined, 'm'],
  ['2025存档/示例-山景.jpg', 'mountain', 1920, 1080, 412_000, undefined, 'm'],
  ['示例-日落-主图.png', 'sunset', 1600, 1200, 1_380_000],
  ['示例-日落-小图.jpg', 'sunset', 800, 600, 186_000],
  ['示例-日落-调色版.jpg', 'sunset', 1600, 1200, 524_000, { brightness: 30 }],
  ['示例-日落-加角标.png', 'sunset', 1600, 1200, 1_402_000, { badge: true }],
  ['示例-波纹-横版.png', 'rings', 1200, 1200, 960_000],
  ['示例-波纹-压缩.jpg', 'rings', 600, 600, 98_000],
  ['示例-圆点.png', 'dots', 1080, 1080, 230_000],
  ['示例-条纹.png', 'stripes', 1080, 720, 150_000],
  ['示例-色块.png', 'blocks', 1080, 1080, 88_000],
];

function thumb(p: Pattern, w: number, h: number, o?: SynthOpts) {
  const k = 240 / Math.max(w, h);
  const tw = Math.round(w * k);
  const th = Math.round(h * k);
  const c = document.createElement('canvas');
  c.width = tw;
  c.height = th;
  c.getContext('2d')!.putImageData(new ImageData(synth(p, tw, th, o) as unknown as Uint8ClampedArray<ArrayBuffer>, tw, th), 0, 0);
  return c.toDataURL('image/jpeg', 0.85);
}

export function demoState() {
  const assets: Asset[] = LIST.map(([name, p, w, h, size, o, same], i) => ({
    id: `d${i}`, name: name.split('/').pop()!, path: `${ROOT}/${name}`, root: ROOT, size, width: w, height: h,
    ...fingerprint(synth(p, 32, 32, o), 32, 32), content: same ?? `c${i}`, thumb: thumb(p, w, h, o),
  }));
  return { assets, groups: groupAssets(assets, 6), failed: [{ name: '示例-损坏.jpg', path: `${ROOT}/示例-损坏.jpg`, reason: '无法识别这张图片，可能已损坏或格式不受支持' }], roots: [ROOT] };
}
