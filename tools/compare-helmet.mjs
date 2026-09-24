/**
 * compare-helmet.mjs — 一次生成多组头盔尺寸/位置，拼成对比图
 *
 * 直接 import 合成函数，不启子进程 —— 这个环境里 child_process 捕获
 * 子进程输出会失败，而且 import 本来也更快更清晰。
 *
 * 用法: node tools/compare-helmet.mjs
 */
import sharp from 'sharp';
import { rm } from 'node:fs/promises';
import { composeHelmet } from './compose-hero.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));

// [标签, 头盔高度, 中心x, 顶部y, 旋转, 不透明度]
const VARIANTS = [
  ['A h900 top-20',       900, 570, -20, 0, 1],
  ['B h800 top40',        800, 570,  40, 0, 1],
  ['C h720 top95',        720, 570,  95, 0, 1],
  ['D h760 top60 rot-6',  760, 570,  60, -6, 1],
  ['E h800 rot+7',        800, 570,  40, 7, 1],
  ['F h800 透明85%',      800, 570,  40, 0, 0.85],
];

const TILE_W = 300, TILE_H = 390;
const tiles = [];

for (const [i, [label, h, cx, top, rot, opacity]] of VARIANTS.entries()) {
  // 每个变体写各自的文件，避免同一路径被反复覆盖。
  // Windows 上同一个进程里连续写同一个路径会撞 EBUSY / "unable to open for write"。
  const out = `tools/helmet-variants/${String(i).padStart(2, '0')}`;
  await composeHelmet({ h, cx, top, rot, opacity, out, silent: true });

  const img = await sharp(`${out}.webp`)
    .resize({ width: TILE_W, height: TILE_H - 34, fit: 'contain', background: { r: 17, g: 17, b: 18, alpha: 1 } })
    .png().toBuffer();

  const labelSvg = Buffer.from(
    `<svg width="${TILE_W}" height="${TILE_H}" xmlns="http://www.w3.org/2000/svg">
       <rect x="0" y="0" width="${TILE_W}" height="34" fill="#111112"/>
       <text x="10" y="23" font-family="monospace" font-size="15" fill="#d2ff00">${label}</text>
     </svg>`);
  const labelBuf = await sharp(labelSvg).resize(TILE_W, TILE_H, { fit: 'fill' }).png().toBuffer();

  const composed = await sharp({
    create: { width: TILE_W, height: TILE_H, channels: 4, background: { r: 17, g: 17, b: 18, alpha: 1 } },
  }).composite([
    { input: img, left: 0, top: 34 },
    { input: labelBuf, left: 0, top: 0 },
  ]).png().toBuffer();

  tiles.push(composed);
  console.log(`  ✓ ${label}`);
}

const cols = 3, rows = Math.ceil(tiles.length / cols);
const GAP = 6;
await sharp({
  create: {
    width: TILE_W * cols + GAP * (cols + 1),
    height: TILE_H * rows + GAP * (rows + 1),
    channels: 4,
    background: { r: 45, g: 45, b: 50, alpha: 1 },
  },
}).composite(tiles.map((t, i) => ({
  input: t,
  left: (i % cols) * (TILE_W + GAP) + GAP,
  top: Math.floor(i / cols) * (TILE_H + GAP) + GAP,
}))).png().toFile('tools/shots/helmet-compare.png');

console.log('\n对比图: tools/shots/helmet-compare.png');
