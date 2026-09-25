/**
 * crop-user-shots.mjs — 从用户提供的截图里裁出镂空字做对比
 *
 * 用途：当"哪里不一样"说不清时，直接拿用户看到的两张图对比，
 * 比在我们自己的截图上猜要可靠。
 *
 * 注意：这里的裁切坐标是针对这两张具体截图手量的，
 * 换图要重新量 —— 所以它是一次性诊断工具，不是常驻检查。
 *
 * 用法: node tools/crop-user-shots.mjs
 */
import sharp from 'sharp';
import { existsSync } from 'node:fs';

const A = 'C:\\Users\\Lenovo\\.dsh\\attachments\\v1\\objects\\eb\\' +
  'eb956603b2094f570f4f6f1864dd63298dd2c81bef20202b2105176cbd8ac7ac';   // 手机
const B = 'C:\\Users\\Lenovo\\.dsh\\attachments\\v1\\objects\\fd\\' +
  'fde7eac1b676c88cfb6678dbb9c8f9394f045e5776228e94683b42a3860b4b87';   // 电脑

const SHOTS = [
  ['用户截图 · 手机', A, { left: 300, top: 1900, width: 800, height: 400 }],
  ['用户截图 · 电脑', B, { left: 760, top: 1280, width: 950, height: 340 }],
];

const TILE_W = 900;
const tiles = [];

for (const [label, src, crop] of SHOTS) {
  if (!existsSync(src)) { console.log(`  ✗ 找不到 ${label}`); continue; }
  const meta = await sharp(src).metadata();
  console.log(`  ${label}: ${meta.width}x${meta.height}`);

  const c = {
    left: Math.max(0, Math.min(crop.left, meta.width - 10)),
    top: Math.max(0, Math.min(crop.top, meta.height - 10)),
    width: Math.min(crop.width, meta.width - crop.left),
    height: Math.min(crop.height, meta.height - crop.top),
  };
  const out = await sharp(src).extract(c)
    .resize({ width: TILE_W - 24, kernel: 'lanczos3' }).png().toBuffer();
  const om = await sharp(out).metadata();

  const svg = await sharp(Buffer.from(
    `<svg width="${TILE_W}" height="${om.height + 44}" xmlns="http://www.w3.org/2000/svg">
       <rect width="${TILE_W}" height="44" fill="#111112"/>
       <text x="14" y="28" font-family="monospace" font-size="20" fill="#d2ff00">${label}</text>
     </svg>`)).resize(TILE_W, om.height + 44, { fit: 'fill' }).png().toBuffer();

  tiles.push(await sharp({
    create: { width: TILE_W, height: om.height + 44, channels: 4,
              background: { r: 17, g: 17, b: 18, alpha: 1 } },
  }).composite([
    { input: out, left: 12, top: 38 },
    { input: svg, left: 0, top: 0 },      // 背景只盖标题条，别盖住截图
  ]).png().toBuffer());
  console.log(`    ✓ 裁 ${c.width}x${c.height}`);
}

if (!tiles.length) { console.log('\n没有可对比的图'); process.exit(1); }

const metas = await Promise.all(tiles.map(t => sharp(t).metadata()));
const H = metas.reduce((s, m) => s + m.height + 10, 10);
await sharp({
  create: { width: TILE_W + 20, height: H, channels: 4, background: { r: 45, g: 45, b: 50, alpha: 1 } },
}).composite(tiles.map((t, i) => ({
  input: t, left: 10,
  top: 10 + metas.slice(0, i).reduce((s, m) => s + m.height + 10, 0),
}))).png().toFile('tools/shots/user-shots-compare.png');

console.log('\n对比图: tools/shots/user-shots-compare.png');
