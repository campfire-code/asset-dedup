import { describe, expect, it } from 'vitest';
import {
  UnionFind, contentHash, dHash, fingerprint, formatBytes, groupAssets, hamming, inTrash, isFlat, manifestName, manifestText, pickKeep,
  planMoves, resizeArea, similarity, thresholdLabel, toGray, uniqueName, type Asset,
} from './core';
import { SAMPLE_FILES, synth, type Pattern } from './synth';

/** 把大图面积平均缩到 32×32（模拟画布缩放）再算指纹 */
function fpOf(rgba: Uint8ClampedArray, w: number, h: number) {
  const ch = [0, 1, 2, 3].map((c) => resizeArea(Array.from({ length: w * h }, (_, i) => rgba[i * 4 + c]), w, h, 32, 32));
  const small = new Uint8ClampedArray(32 * 32 * 4);
  for (let i = 0; i < 32 * 32; i++) for (let c = 0; c < 4; c++) small[i * 4 + c] = ch[c][i];
  return fingerprint(small, 32, 32);
}

let seq = 0;
function asset(p: Partial<Asset> & { hash: string }): Asset {
  const id = p.id ?? `x${seq++}`;
  return { id, path: `/图/${id}.jpg`, name: `${id}.jpg`, root: '/图', size: 1000, width: 100, height: 100, flat: false, content: id, ...p };
}

describe('灰度与缩放', () => {
  it('按亮度权重转灰度，透明按白底', () => {
    const g = toGray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 0, 0], 3, 1);
    expect(g[0]).toBeCloseTo(76.245);
    expect(g[1]).toBeCloseTo(149.685);
    expect(g[2]).toBe(255);
  });
  it('面积平均：2×2 缩到 1×1 取平均；缩放非整数倍时按覆盖面积加权', () => {
    expect([...resizeArea([0, 100, 200, 300], 2, 2, 1, 1)]).toEqual([150]);
    const r = resizeArea([0, 90, 180], 3, 1, 2, 1);
    expect(r[0]).toBeCloseTo(30);
    expect(r[1]).toBeCloseTo(150);
  });
  it('放大时复制像素', () => {
    expect([...resizeArea([10, 20], 2, 1, 4, 1)]).toEqual([10, 10, 20, 20]);
  });
});

describe('dHash 与汉明距离', () => {
  it('从左到右变亮的图每位都是 0，变暗的每位都是 1', () => {
    const up = Array.from({ length: 9 * 8 }, (_, i) => i % 9);
    const down = up.map((v) => 8 - v);
    expect(dHash(up, 9, 8)).toBe('0000000000000000');
    expect(dHash(down, 9, 8)).toBe('ffffffffffffffff');
    expect(hamming('0000000000000000', 'ffffffffffffffff')).toBe(64);
  });
  it('汉明距离数的是不同的位', () => {
    expect(hamming('0000000000000001', '0000000000000000')).toBe(1);
    expect(hamming('8000000080000000', '0000000000000000')).toBe(2);
    expect(hamming('0123456789abcdef', '0123456789abcdef')).toBe(0);
  });
  it('同一画面缩小、调暗、加小角标，距离都很小；不同画面距离大', () => {
    const base = fpOf(synth('sunset', 400, 300), 400, 300);
    const small = fpOf(synth('sunset', 200, 150), 200, 150);
    const bright = fpOf(synth('sunset', 400, 300, { brightness: -16 }), 400, 300);
    const badge = fpOf(synth('sunset', 400, 300, { badge: true }), 400, 300);
    expect(hamming(base.hash, small.hash)).toBeLessThanOrEqual(3);
    expect(hamming(base.hash, bright.hash)).toBeLessThanOrEqual(3);
    expect(hamming(base.hash, badge.hash)).toBeLessThanOrEqual(6);
    const others: Pattern[] = ['mountain', 'rings', 'dots', 'stripes', 'blocks'];
    for (const p of others) expect(hamming(base.hash, fpOf(synth(p, 300, 300), 300, 300).hash), p).toBeGreaterThan(12);
  });
  it('纯色图识别为纯色', () => {
    expect(isFlat(new Array(64).fill(128))).toBe(true);
    expect(isFlat(Array.from({ length: 64 }, (_, i) => i * 4))).toBe(false);
  });
});

describe('内容指纹', () => {
  it('与 FNV-1a 64 位公开测试值一致，并带上长度', () => {
    expect(contentHash(new Uint8Array())).toBe('cbf29ce484222325:0');
    expect(contentHash(new TextEncoder().encode('a'))).toBe('af63dc4c8601ec8c:1');
    expect(contentHash(new TextEncoder().encode('foobar'))).toBe('85944171f73967e8:6');
  });
  it('改一个字节指纹就不同', () => {
    expect(contentHash(new Uint8Array([1, 2, 3]))).not.toBe(contentHash(new Uint8Array([1, 2, 4])));
  });
});

describe('分组', () => {
  it('并查集合并后同根', () => {
    const u = new UnionFind(5);
    u.union(0, 3); u.union(3, 4);
    expect(u.find(4)).toBe(u.find(0));
    expect(u.find(1)).not.toBe(u.find(0));
  });
  it('距离不超过阈值的归一组，链式相近也会连到一起；单张不成组', () => {
    const a = asset({ id: 'a', hash: '0000000000000000' });
    const b = asset({ id: 'b', hash: '000000000000000f' }); // 与 a 差 4
    const c = asset({ id: 'c', hash: '00000000000000ff' }); // 与 b 差 4、与 a 差 8
    const d = asset({ id: 'd', hash: 'ffffffff00000000' });
    expect(groupAssets([a, b, c, d], 4).map((g) => g.members.map((m) => m.id).sort())).toEqual([['a', 'b', 'c']]);
    expect(groupAssets([a, b, c, d], 3)).toEqual([]);
  });
  it('内容完全一样的不看哈希也归一组，并标记为完全相同', () => {
    const a = asset({ id: 'a', hash: '0000000000000000', content: 'same' });
    const b = asset({ id: 'b', hash: 'ffffffffffffffff', content: 'same' });
    const [g] = groupAssets([a, b], 0);
    expect(g.exact).toBe(true);
    expect(g.maxDistance).toBe(0);
  });
  it('纯色图只按完全相同判断，不会把所有纯色图混在一起', () => {
    const w = asset({ id: 'w', hash: '0000000000000000', flat: true });
    const k = asset({ id: 'k', hash: '0000000000000000', flat: true });
    expect(groupAssets([w, k], 10)).toEqual([]);
  });
  it('默认保留分辨率最高的，其次文件大的，其次文件名短的', () => {
    const s = asset({ id: 's', hash: '0', width: 400, height: 300, size: 9000 });
    const l = asset({ id: 'l', hash: '0', width: 800, height: 600, size: 5000 });
    expect(pickKeep([s, l]).id).toBe('l');
    const n1 = asset({ id: 'n1', hash: '0', name: '图-副本.jpg' });
    const n2 = asset({ id: 'n2', hash: '0', name: '图.jpg' });
    expect(pickKeep([n1, n2]).id).toBe('n2');
  });
  it('完全相同的组排在前面，组内保留图排第一', () => {
    const near = [asset({ id: 'n1', hash: '0000000000000000', width: 50 }), asset({ id: 'n2', hash: '0000000000000003' }), asset({ id: 'n3', hash: '0000000000000001' })];
    const same = [asset({ id: 's1', hash: 'ff00ff00ff00ff00', content: 'S' }), asset({ id: 's2', hash: 'ff00ff00ff00ff00', content: 'S', width: 200 })];
    const gs = groupAssets([...near, ...same], 4);
    expect(gs.map((g) => g.members[0].id)).toEqual(['s2', 'n2']);
    expect(gs[1].maxDistance).toBe(2);
  });
});

describe('移动计划', () => {
  const join = (...p: string[]) => p.join('/');
  it('每组除保留图外移到各自根文件夹的「待删除」，可改保留图、可跳过整组', () => {
    const g1 = { members: [asset({ id: 'k', hash: '0' }), asset({ id: 'd1', hash: '0', name: '海报.jpg', size: 10 })], exact: true, maxDistance: 0 };
    const g2 = { members: [asset({ id: 'p', hash: '0', root: '/另一个', path: '/另一个/p.jpg' }), asset({ id: 'q', hash: '0', root: '/另一个', name: 'q.png', path: '/另一个/子/q.png' })], exact: false, maxDistance: 2 };
    const g3 = { members: [asset({ id: 'z1', hash: '0' }), asset({ id: 'z2', hash: '0' })], exact: false, maxDistance: 1 };
    const plans = planMoves([g1, g2, g3], { 1: 'q' }, new Set([2]), join);
    expect(plans.map((p) => [p.from, p.to])).toEqual([
      ['/图/d1.jpg', '/图/待删除/海报.jpg'],
      ['/另一个/p.jpg', '/另一个/待删除/p.jpg'],
    ]);
  });
  it('重名自动加序号，已有文件也会避开（不区分大小写）', () => {
    const taken = new Set(['a.jpg']);
    expect(uniqueName('A.jpg', taken)).toBe('A (2).jpg');
    expect(uniqueName('a.jpg', taken)).toBe('a (3).jpg');
    expect(uniqueName('b', taken)).toBe('b');
    const g = { members: [asset({ id: 'k', hash: '0' }), asset({ id: 'x', hash: '0', name: '图.jpg', path: '/图/1/图.jpg' }), asset({ id: 'y', hash: '0', name: '图.jpg', path: '/图/2/图.jpg' })], exact: true, maxDistance: 0 };
    const plans = planMoves([g], {}, new Set(), join, new Map([['/图/待删除', new Set(['图.jpg'])]]));
    expect(plans.map((p) => p.name)).toEqual(['图 (2).jpg', '图 (3).jpg']);
  });
  it('识别待删除文件夹里的路径', () => {
    expect(inTrash('/a/待删除/x.jpg')).toBe(true);
    expect(inTrash('C:\\图\\待删除\\x.jpg')).toBe(true);
    expect(inTrash('/a/待删除的图.jpg')).toBe(false);
  });
});

describe('文字', () => {
  it('大小、相似度、阈值说明、清单', () => {
    expect(formatBytes(2_500_000)).toBe('2.4 MB');
    expect(similarity(0)).toBe('100%');
    expect(similarity(6)).toBe('91%');
    expect(thresholdLabel(0)).toContain('完全一样');
    expect(thresholdLabel(6)).toContain('标准');
    const now = new Date(2026, 9, 23, 9, 5, 7);
    expect(manifestName(now)).toBe('移动清单-20261023-090507.txt');
    expect(manifestText([{ from: '/a/1.jpg', to: '/a/待删除/1.jpg', name: '1.jpg', size: 1 }], now)).toContain('/a/1.jpg\t→\t/a/待删除/1.jpg');
  });
});

describe('示例文件', () => {
  it('示例图按预期分成两组：山景 3 张完全相同、日落 4 张近似', () => {
    const assets: Asset[] = SAMPLE_FILES.map((f, i) => {
      // 缩小比例生成，测试更快；完全相同的副本共用内容指纹
      const w = Math.round(f.w / 4);
      const h = Math.round(f.h / 4);
      const fp = fpOf(synth(f.pattern, w, h, f.opts), w, h);
      return asset({ id: `s${i}`, name: f.file, path: '/示例/' + f.file, width: f.w, height: f.h, ...fp, content: f.copyOf ?? f.file });
    });
    const gs = groupAssets(assets, 6);
    expect(gs.map((g) => [g.exact, g.members.map((m) => m.name)])).toEqual([
      [true, ['示例-山景.png', '示例-山景-副本.png', '旧素材/示例-山景-再存一份.png']],
      [false, ['示例-日落.png', '示例-日落-缩小.png', '示例-日落-调暗.png', '示例-日落-加角标.png']],
    ]);
  });
});
