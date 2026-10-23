// 生成 samples/ 里的示例图片（只在设置了 MAKE_SAMPLES=1 时运行）。图案是 synth.ts 程序画的几何图形。
import { it } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { SAMPLE_FILES, synth } from './synth';

const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
/** 最简 PNG 编码：8 位 RGBA，每行过滤方式 0 */
function png(rgba: Uint8ClampedArray, w: number, h: number) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) Buffer.from(rgba.buffer, y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

it.runIf(process.env.MAKE_SAMPLES === '1')('生成示例图片', () => {
  const root = 'samples/示例素材库/';
  mkdirSync(root + '旧素材', { recursive: true });
  for (const f of SAMPLE_FILES) {
    const data = f.copyOf ? readFileSync(root + f.copyOf) : png(synth(f.pattern, f.w, f.h, f.opts), f.w, f.h);
    writeFileSync(root + f.file, data);
  }
  // 一个扩展名是 jpg、内容却不是图片的文件：用来验证「读取失败」
  writeFileSync(root + '示例-损坏.jpg', Buffer.from('这不是一张图片'));
});
