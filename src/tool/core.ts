// 纯函数：灰度、缩放、差异哈希（dHash）、汉明距离、内容指纹、分组与移动计划。
// 不依赖界面和本机能力，便于单元测试。

export const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif'];
/** 移走的重复项放进这个文件夹（每个扫描的根文件夹下各一个），扫描时跳过它 */
export const TRASH_DIR = '待删除';

/** RGBA 像素转灰度（ITU-R BT.601 亮度权重），透明部分按白底合成 */
export function toGray(rgba: ArrayLike<number>, w: number, h: number): Float64Array {
  const out = new Float64Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const a = rgba[i * 4 + 3] / 255;
    const y = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
    out[i] = y * a + 255 * (1 - a);
  }
  return out;
}

/** 面积平均缩放（每个目标像素取覆盖区域的加权平均），放大缩小都可以 */
export function resizeArea(src: ArrayLike<number>, w: number, h: number, tw: number, th: number): Float64Array {
  const out = new Float64Array(tw * th);
  const sx = w / tw;
  const sy = h / th;
  for (let ty = 0; ty < th; ty++) {
    const y0 = ty * sy;
    const y1 = y0 + sy;
    for (let tx = 0; tx < tw; tx++) {
      const x0 = tx * sx;
      const x1 = x0 + sx;
      let sum = 0;
      let area = 0;
      for (let y = Math.floor(y0); y < Math.min(h, Math.ceil(y1)); y++) {
        const wy = Math.min(y + 1, y1) - Math.max(y, y0);
        for (let x = Math.floor(x0); x < Math.min(w, Math.ceil(x1)); x++) {
          const wx = Math.min(x + 1, x1) - Math.max(x, x0);
          sum += src[y * w + x] * wx * wy;
          area += wx * wy;
        }
      }
      out[ty * tw + tx] = area ? sum / area : 0;
    }
  }
  return out;
}

/**
 * 差异哈希：缩到 9×8 灰度，每行比较相邻两点（左比右亮记 1；忽略浮点误差，避免纯色行乱跳），得到 64 位，返回 16 位十六进制。
 * 对缩放、轻微压缩、亮度整体变化不敏感。
 */
export function dHash(gray: ArrayLike<number>, w: number, h: number): string {
  const s = resizeArea(gray, w, h, 9, 8);
  let hex = '';
  for (let half = 0; half < 2; half++) {
    let v = 0;
    for (let i = 0; i < 32; i++) {
      const bit = half * 32 + i;
      const y = Math.floor(bit / 8);
      const x = bit % 8;
      v = (v * 2) + (s[y * 9 + x] - s[y * 9 + x + 1] > 1e-6 ? 1 : 0);
    }
    hex += v.toString(16).padStart(8, '0');
  }
  return hex;
}

/** 画面几乎是纯色（灰度标准差很小）：这类图的 dHash 没有区分度，只按完全相同来判断 */
export function isFlat(gray: ArrayLike<number>, limit = 2): boolean {
  const n = gray.length;
  if (!n) return true;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += gray[i];
  const mean = sum / n;
  let v = 0;
  for (let i = 0; i < n; i++) v += (gray[i] - mean) ** 2;
  return Math.sqrt(v / n) < limit;
}

/** 从 RGBA 小图算出哈希和是否纯色 */
export function fingerprint(rgba: ArrayLike<number>, w: number, h: number): { hash: string; flat: boolean } {
  const g = toGray(rgba, w, h);
  return { hash: dHash(g, w, h), flat: isFlat(g) };
}

function popcount32(n: number): number {
  n = n - ((n >>> 1) & 0x55555555);
  n = (n & 0x33333333) + ((n >>> 2) & 0x33333333);
  return (((n + (n >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

/** 十六进制哈希拆成两个 32 位整数，方便快速比较 */
export const splitHash = (hex: string): [number, number] => [parseInt(hex.slice(0, 8), 16) >>> 0, parseInt(hex.slice(8, 16), 16) >>> 0];

/** 两个 64 位哈希之间不同的位数（0 = 一样，64 = 完全相反） */
export function hamming(a: string, b: string): number {
  const [a1, a2] = splitHash(a);
  const [b1, b2] = splitHash(b);
  return popcount32((a1 ^ b1) >>> 0) + popcount32((a2 ^ b2) >>> 0);
}

/** 文件内容指纹（FNV-1a 64 位）：内容完全一样的文件指纹一样，用于找「完全相同」 */
export function contentHash(bytes: Uint8Array): string {
  let h1 = 0x84222325;
  let h2 = 0xcbf29ce4;
  for (let i = 0; i < bytes.length; i++) {
    h1 = (h1 ^ bytes[i]) >>> 0;
    // 乘以 FNV 质数 0x100000001b3（拆成高低 32 位计算）
    const lo = h1 * 0x1b3;
    const hi = h2 * 0x1b3 + h1 * 0x100 + Math.floor(lo / 0x100000000);
    h1 = lo >>> 0;
    h2 = hi >>> 0;
  }
  return h2.toString(16).padStart(8, '0') + h1.toString(16).padStart(8, '0') + ':' + bytes.length;
}

export interface Asset {
  id: string;
  path: string;
  name: string;
  /** 扫描时选的文件夹（或拖入的文件所在文件夹），待删除文件夹建在这里 */
  root: string;
  size: number;
  width: number;
  height: number;
  hash: string;
  flat: boolean;
  content: string;
  /** 缩略图 data: 地址 */
  thumb?: string;
}

export interface Group {
  members: Asset[];
  /** 组内完全相同（内容指纹一样） */
  exact: boolean;
  /** 组内与保留图的最大哈希差异 */
  maxDistance: number;
}

/** 并查集 */
export class UnionFind {
  private p: number[];
  constructor(n: number) { this.p = Array.from({ length: n }, (_, i) => i); }
  find(x: number): number {
    while (this.p[x] !== x) { this.p[x] = this.p[this.p[x]]; x = this.p[x]; }
    return x;
  }
  union(a: number, b: number) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.p[Math.max(ra, rb)] = Math.min(ra, rb);
  }
}

/** 默认保留哪张：分辨率最高 → 文件最大 → 文件名最短 → 路径排序靠前 */
export function pickKeep(members: Asset[]): Asset {
  return [...members].sort((a, b) => b.width * b.height - a.width * a.height || b.size - a.size || a.name.length - b.name.length || (a.path < b.path ? -1 : 1))[0];
}

/**
 * 分组：内容完全一样的直接归一组；哈希差异不超过 threshold 的也归一组（纯色图只按完全相同判断）。
 * 只返回两张及以上的组，组按「完全相同在前、张数多在前」排序，组内保留图排第一。
 */
export function groupAssets(assets: Asset[], threshold: number): Group[] {
  const uf = new UnionFind(assets.length);
  const byContent = new Map<string, number>();
  assets.forEach((a, i) => {
    const j = byContent.get(a.content);
    if (j === undefined) byContent.set(a.content, i);
    else uf.union(i, j);
  });
  const hs = assets.map((a) => splitHash(a.hash));
  for (let i = 0; i < assets.length; i++) {
    if (assets[i].flat) continue;
    const [x1, x2] = hs[i];
    for (let j = i + 1; j < assets.length; j++) {
      if (assets[j].flat) continue;
      const d = popcount32((x1 ^ hs[j][0]) >>> 0) + popcount32((x2 ^ hs[j][1]) >>> 0);
      if (d <= threshold) uf.union(i, j);
    }
  }
  const buckets = new Map<number, Asset[]>();
  assets.forEach((a, i) => {
    const r = uf.find(i);
    buckets.set(r, [...(buckets.get(r) ?? []), a]);
  });
  const groups: Group[] = [];
  for (const members of buckets.values()) {
    if (members.length < 2) continue;
    const keep = pickKeep(members);
    const ordered = [keep, ...members.filter((m) => m !== keep)];
    const exact = members.every((m) => m.content === members[0].content);
    const maxDistance = Math.max(...ordered.slice(1).map((m) => (m.content === keep.content ? 0 : hamming(m.hash, keep.hash))));
    groups.push({ members: ordered, exact, maxDistance });
  }
  return groups.sort((a, b) => Number(b.exact) - Number(a.exact) || b.members.length - a.members.length || (a.members[0].path < b.members[0].path ? -1 : 1));
}

/** 相似度说明：0 位差异 → 100%，按 64 位换算 */
export const similarity = (distance: number) => `${Math.round((1 - distance / 64) * 100)}%`;

/** 阈值的文字说明 */
export function thresholdLabel(t: number): string {
  if (t <= 0) return '只找完全一样的画面';
  if (t <= 4) return '严格：只找几乎一样的';
  if (t <= 8) return '标准：缩放、压缩、轻微调色也能找到';
  if (t <= 12) return '宽松：可能把构图相近的不同图归到一起';
  return '很宽松：误判会明显变多，移动前请逐组检查';
}

export interface MovePlan {
  from: string;
  to: string;
  name: string;
  size: number;
}

const splitExt = (name: string): [string, string] => {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
};

/** 目标文件夹里已有同名文件时，依次改成「名字 (2).jpg」「名字 (3).jpg」 */
export function uniqueName(name: string, taken: Set<string>): string {
  const lower = (s: string) => s.toLowerCase();
  if (!taken.has(lower(name))) { taken.add(lower(name)); return name; }
  const [base, ext] = splitExt(name);
  for (let i = 2; ; i++) {
    const n = `${base} (${i})${ext}`;
    if (!taken.has(lower(n))) { taken.add(lower(n)); return n; }
  }
}

/**
 * 移动计划：每组除了保留的那张，其余移到各自根文件夹下的「待删除」。
 * keep：组序号 → 保留图 id（不填用组里第一张）；skip：不处理的组序号。
 * existing：每个待删除文件夹里已有的文件名（小写），用来避开重名。
 */
export function planMoves(
  groups: Group[],
  keep: Record<number, string>,
  skip: Set<number>,
  join: (...p: string[]) => string,
  existing: Map<string, Set<string>> = new Map(),
): MovePlan[] {
  const plans: MovePlan[] = [];
  groups.forEach((g, gi) => {
    if (skip.has(gi)) return;
    const keepId = keep[gi] ?? g.members[0].id;
    for (const m of g.members) {
      if (m.id === keepId) continue;
      const dir = join(m.root, TRASH_DIR);
      const taken = existing.get(dir) ?? new Set<string>();
      existing.set(dir, taken);
      const name = uniqueName(m.name, taken);
      plans.push({ from: m.path, to: join(dir, name), name, size: m.size });
    }
  });
  return plans;
}

/** 路径是否在「待删除」文件夹里（扫描时跳过） */
export const inTrash = (path: string) => path.split(/[\\/]/).includes(TRASH_DIR);

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/** 移动清单文件名：移动清单-20261023-091200.txt */
export function manifestName(now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `移动清单-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}.txt`;
}

/** 移动清单内容：每行「原位置 → 新位置」，方便手动放回 */
export function manifestText(moved: MovePlan[], now: Date): string {
  return [
    `素材库查重 · ${now.toLocaleString('zh-CN', { hour12: false })} 移动了 ${moved.length} 个文件`,
    '如需恢复，把文件从右边的位置移回左边的位置即可。',
    '',
    ...moved.map((m) => `${m.from}\t→\t${m.to}`),
    '',
  ].join('\n');
}
