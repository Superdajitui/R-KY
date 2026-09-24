/**
 * grid.mjs — 给图片叠加坐标网格，用来目测定位
 * 用法: node tools/grid.mjs <图片> <输出> [网格间距]
 */
import sharp from 'sharp';

const SRC = process.argv[2] || 'assets/img/portrait-1400.webp';
const OUT = process.argv[3] || 'tools/shots/grid.png';
const STEP = Number(process.argv[4]) || 100;

const meta = await sharp(SRC).metadata();
const { width: W, height: H } = meta;

let lines = '';
for (let x = 0; x <= W; x += STEP) {
  const major = x % (STEP * 2) === 0;
  lines += `<line x1="${x}" y1="0" x2="${x}" y2="${H}" stroke="${major ? '#d2ff00' : '#ffffff'}" stroke-width="${major ? 2 : 1}" opacity="${major ? 0.85 : 0.32}"/>`;
  if (major) lines += `<text x="${x + 6}" y="26" font-family="monospace" font-size="22" fill="#d2ff00">${x}</text>`;
}
for (let y = 0; y <= H; y += STEP) {
  const major = y % (STEP * 2) === 0;
  lines += `<line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="${major ? '#d2ff00' : '#ffffff'}" stroke-width="${major ? 2 : 1}" opacity="${major ? 0.85 : 0.32}"/>`;
  if (major) lines += `<text x="6" y="${y + 26}" font-family="monospace" font-size="22" fill="#d2ff00">${y}</text>`;
}

// 先用洋红底合成，既能看到边界也能看到网格
const base = await sharp({ create: { width: W, height: H, channels: 4, background: { r: 255, g: 0, b: 255, alpha: 1 } } })
  .composite([{ input: await sharp(SRC).ensureAlpha().toBuffer() }])
  .png().toBuffer();

// SVG 光栅化后的实际尺寸不一定等于声明的 width/height（librsvg 会按 DPI 缩放），
// 所以显式 resize 到画布尺寸，否则 composite 会报尺寸不匹配
const grid = await sharp(Buffer.from(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${lines}</svg>`))
  .resize(W, H, { fit: 'fill' })
  .png().toBuffer();

// 注意 sharp 的流水线顺序：resize 先于 composite 执行。
// 所以不能写成 .composite(grid).resize(700) —— 那会先缩到 700 宽，
// 再把 1115 宽的网格贴上去，直接报尺寸不匹配。必须分两步。
const composed = await sharp(base)
  .composite([{ input: grid }])
  .png().toBuffer();

await sharp(composed).resize({ width: 700 }).png().toFile(OUT);

console.log(`${SRC}  ${W}x${H}  ->  ${OUT}  (网格 ${STEP}px)`);
