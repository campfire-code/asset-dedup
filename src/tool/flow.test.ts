import { describe, expect, it } from 'vitest';
import { groupAssets, planMoves } from './core';
import { moveFiles, scanFiles, type Decoded, type FoundFile, type MoveIO } from './flow';
import { synth, type Pattern } from './synth';

/** 内存假文件系统 */
function memFs(files: Record<string, Uint8Array>) {
  const fs = new Map(Object.entries(files));
  const dirs = new Set<string>();
  const io: MoveIO & { readFile(p: string): Promise<Uint8Array> } = {
    join: async (...p) => p.join('/'),
    mkdir: async (p) => void dirs.add(p),
    exists: async (p) => fs.has(p) || dirs.has(p),
    rename: async (a, b) => {
      if (!fs.has(a)) throw new Error('没有这个文件');
      if (b.startsWith('/只读/')) throw new Error('没有权限');
      fs.set(b, fs.get(a)!);
      fs.delete(a);
    },
    writeText: async (p, t) => void fs.set(p, new TextEncoder().encode(t)),
    readFile: async (p) => {
      const d = fs.get(p);
      if (!d) throw new Error('文件不存在');
      return d;
    },
  };
  return { fs, dirs, io };
}

/** 假解码：文件内容第一个字节代表图案编号，第二个字节代表亮度变化；内容是「坏」的就报错 */
const PATTERNS: Pattern[] = ['mountain', 'sunset', 'rings', 'dots'];
async function fakeDecode(bytes: Uint8Array): Promise<Decoded> {
  if (bytes[0] === 255) throw new Error('无法识别这张图片');
  return { width: 100 + bytes.length, height: 100, side: 32, rgba: synth(PATTERNS[bytes[0]], 32, 32, { brightness: -bytes[1] }) };
}
const file = (path: string, root = '/素材'): FoundFile => ({ path, name: path.split('/').pop()!, size: 0, root });

describe('扫描', () => {
  it('读取 → 解码 → 指纹，坏图记到失败里不影响其他；跳过待删除文件夹', async () => {
    const { io } = memFs({
      '/素材/a.jpg': new Uint8Array([0, 0]),
      '/素材/a-副本.jpg': new Uint8Array([0, 0]),
      '/素材/b.jpg': new Uint8Array([1, 0, 9]),
      '/素材/b-暗.jpg': new Uint8Array([1, 12]),
      '/素材/c.jpg': new Uint8Array([2, 0]),
      '/素材/坏.jpg': new Uint8Array([255]),
      '/素材/待删除/旧.jpg': new Uint8Array([0, 0]),
    });
    const progress: number[] = [];
    const paths = ['/素材/a.jpg', '/素材/a-副本.jpg', '/素材/b.jpg', '/素材/b-暗.jpg', '/素材/c.jpg', '/素材/坏.jpg', '/素材/待删除/旧.jpg', '/素材/丢了.jpg'];
    const r = await scanFiles(paths.map((p) => file(p)), { readFile: io.readFile, decode: fakeDecode }, (d) => progress.push(d));
    expect(r.assets).toHaveLength(5);
    expect(r.failed.map((f) => [f.name, f.reason])).toEqual([['坏.jpg', '无法识别这张图片'], ['丢了.jpg', '文件不存在']]);
    expect(progress.at(-1)).toBe(7);
    expect(r.assets[2]).toMatchObject({ width: 103, height: 100, size: 3 });
    const gs = groupAssets(r.assets, 6);
    expect(gs.map((g) => [g.exact, g.members.map((m) => m.name)])).toEqual([
      [true, ['a.jpg', 'a-副本.jpg']],
      [false, ['b.jpg', 'b-暗.jpg']],
    ]);
  });

  it('停止后不再继续', async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(scanFiles([file('/素材/a.jpg')], { readFile: async () => new Uint8Array([0]), decode: fakeDecode }, undefined, ac.signal)).rejects.toThrow('已停止');
  });
});

describe('移到待删除', () => {
  it('只移动不删除，写移动清单；目标重名或原文件丢失的记为失败，不覆盖', async () => {
    const { fs, dirs, io } = memFs({
      '/素材/a.jpg': new Uint8Array([0, 0]),
      '/素材/a-副本.jpg': new Uint8Array([0, 0]),
      '/素材/子/a.jpg': new Uint8Array([0, 0]),
      '/素材/b.jpg': new Uint8Array([1, 0, 0]),
      '/素材/b-暗.jpg': new Uint8Array([1, 12]),
    });
    const r0 = await scanFiles(['/素材/a.jpg', '/素材/a-副本.jpg', '/素材/子/a.jpg', '/素材/b.jpg', '/素材/b-暗.jpg'].map((p) => file(p)), { readFile: io.readFile, decode: fakeDecode });
    const groups = groupAssets(r0.assets, 6);
    const plans = planMoves(groups, {}, new Set(), (...p) => p.join('/'));
    expect(plans.map((p) => p.to)).toEqual(['/素材/待删除/a-副本.jpg', '/素材/待删除/a.jpg', '/素材/待删除/b-暗.jpg']);
    // 模拟：移动前有一个文件被用户手动删掉了
    fs.delete('/素材/b-暗.jpg');
    const now = new Date(2026, 9, 23, 10, 0, 0);
    const r = await moveFiles(plans, io, now);
    expect(r.moved.map((m) => m.from)).toEqual(['/素材/a-副本.jpg', '/素材/子/a.jpg']);
    expect(r.failed.map((f) => f.reason)).toEqual(['原文件已不存在']);
    expect(dirs.has('/素材/待删除')).toBe(true);
    expect(fs.has('/素材/a.jpg')).toBe(true);
    expect(fs.has('/素材/a-副本.jpg')).toBe(false);
    expect(fs.has('/素材/待删除/a.jpg')).toBe(true);
    expect(r.manifests).toEqual(['/素材/待删除/移动清单-20261023-100000.txt']);
    const text = new TextDecoder().decode(fs.get(r.manifests[0]));
    expect(text).toContain('移动了 2 个文件');
    expect(text).toContain('/素材/子/a.jpg\t→\t/素材/待删除/a.jpg');
    // 再执行一次同样的计划：目标已存在，不覆盖
    fs.set('/素材/a-副本.jpg', new Uint8Array([0, 0]));
    const again = await moveFiles(plans.slice(0, 1), io, now);
    expect(again.failed[0].reason).toBe('待删除文件夹里已有同名文件');
    expect(again.manifests).toEqual([]);
  });

  it('系统拒绝移动时如实报错', async () => {
    const { io } = memFs({ '/素材/x.jpg': new Uint8Array([0]) });
    const r = await moveFiles([{ from: '/素材/x.jpg', to: '/只读/待删除/x.jpg', name: 'x.jpg', size: 1 }], io, new Date());
    expect(r.failed[0].reason).toBe('没有权限');
  });
});
