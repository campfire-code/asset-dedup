// 扫描与移动流程：读写、解码都从外面传进来，方便用内存假文件系统测试。
import { contentHash, fingerprint, inTrash, manifestName, manifestText, type Asset, type MovePlan } from './core';

export interface FoundFile {
  path: string;
  name: string;
  size: number;
  root: string;
}

/** 解码结果：原图尺寸 + 缩成 side×side 的 RGBA 像素 + 缩略图 */
export interface Decoded {
  width: number;
  height: number;
  rgba: ArrayLike<number>;
  side: number;
  thumb?: string;
}

export interface ScanIO {
  readFile(path: string): Promise<Uint8Array>;
  decode(bytes: Uint8Array): Promise<Decoded>;
}

export interface ScanResult {
  assets: Asset[];
  failed: { name: string; path: string; reason: string }[];
}

/** 逐个读文件、解码、算指纹；读不了或不是有效图片的记到 failed，不中断整批 */
export async function scanFiles(files: FoundFile[], io: ScanIO, onProgress?: (done: number, total: number) => void, signal?: AbortSignal): Promise<ScanResult> {
  const list = files.filter((f) => !inTrash(f.path));
  const assets: Asset[] = [];
  const failed: ScanResult['failed'] = [];
  for (let i = 0; i < list.length; i++) {
    if (signal?.aborted) throw new Error('已停止');
    const f = list[i];
    try {
      const bytes = await io.readFile(f.path);
      const d = await io.decode(bytes);
      const fp = fingerprint(d.rgba, d.side, d.side);
      assets.push({ id: `a${i}`, path: f.path, name: f.name, root: f.root, size: bytes.length, width: d.width, height: d.height, hash: fp.hash, flat: fp.flat, content: contentHash(bytes), thumb: d.thumb });
    } catch (e) {
      failed.push({ name: f.name, path: f.path, reason: e instanceof Error ? e.message : String(e) });
    }
    onProgress?.(i + 1, list.length);
  }
  return { assets, failed };
}

export interface MoveIO {
  join(...parts: string[]): Promise<string>;
  mkdir(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  rename(from: string, to: string): Promise<void>;
  writeText(path: string, text: string): Promise<void>;
}

export interface MoveResult {
  moved: MovePlan[];
  failed: { plan: MovePlan; reason: string }[];
  manifests: string[];
}

/**
 * 按计划把文件移进「待删除」：不删除任何文件。目标已存在时跳过（不覆盖）。
 * 每个待删除文件夹里写一份移动清单，记录原位置，方便放回。
 */
export async function moveFiles(plans: MovePlan[], io: MoveIO, now: Date): Promise<MoveResult> {
  const moved: MovePlan[] = [];
  const failed: MoveResult['failed'] = [];
  const dirOf = (p: string) => p.slice(0, Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\')));
  const made = new Set<string>();
  for (const plan of plans) {
    const dir = dirOf(plan.to);
    try {
      if (!made.has(dir)) { await io.mkdir(dir); made.add(dir); }
      if (await io.exists(plan.to)) throw new Error('待删除文件夹里已有同名文件');
      if (!(await io.exists(plan.from))) throw new Error('原文件已不存在');
      await io.rename(plan.from, plan.to);
      moved.push(plan);
    } catch (e) {
      failed.push({ plan, reason: e instanceof Error ? e.message : String(e) });
    }
  }
  const manifests: string[] = [];
  const byDir = new Map<string, MovePlan[]>();
  for (const m of moved) byDir.set(dirOf(m.to), [...(byDir.get(dirOf(m.to)) ?? []), m]);
  for (const [dir, list] of byDir) {
    const p = await io.join(dir, manifestName(now));
    await io.writeText(p, manifestText(list, now));
    manifests.push(p);
  }
  return { moved, failed, manifests };
}
