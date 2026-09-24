/**
 * zoom-ear.mjs — 放大检查抠图边缘质量
 * 用法: node tools/zoom-ear.mjs
 */
import sharp from 'sharp';

const SRC = 'assets/img/portrait-1400.webp';   // 1115x1400，做质检用这个分辨率
const meta = await sharp(SRC).metadata();
console.log(`检查用图: ${SRC}  ${meta.width} x ${meta.height}`);

async function shot(name, REGION, ZOOM = 3) {
  const w = REGION.width * ZOOM, h = REGION.height * ZOOM;
  const crop = await sharp(SRC).extract(REGION)
    .resize({ width: w, height: h, kernel: 'nearest' }).png().toBuffer();

  const bg = (r, g, b) => ({ create: { width: w, height: h, channels: 4, background: { r, g, b, alpha: 1 } } });

  await sharp(bg(17, 17, 18)).composite([{ input: crop }]).png()
    .toFile(`tools/shots/${name}-dark.png`);
  await sharp(bg(255, 255, 255)).composite([{ input: crop }]).png()
    .toFile(`tools/shots/${name}-white.png`);
  await sharp(bg(255, 0, 255)).composite([{ input: crop }]).png()
    .toFile(`tools/shots/${name}-magenta.png`);

  // 统计该区域 alpha 分布
  const raw = await sharp(SRC).extract(REGION).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const d = raw.data;
  let zero = 0, full = 0, semi = 0;
  for (let i = 3; i < d.length; i += 4) {
    if (d[i] === 0) zero++; else if (d[i] === 255) full++; else semi++;
  }
  const t = d.length / 4;
  console.log(`\n${name}  x=${REGION.left} y=${REGION.top} ${REGION.width}x${REGION.height} (放大 ${ZOOM}x)`);
  console.log(`  alpha → 全透明 ${(zero / t * 100).toFixed(1)}% | 不透明 ${(full / t * 100).toFixed(1)}% | 半透明 ${(semi / t * 100).toFixed(1)}%`);
}

// 整颗头，先定位
await shot('head', { left: 180, top: 60, width: 760, height: 760 }, 1);
// 耳朵特写（图像右侧那只）
await shot('ear', { left: 640, top: 380, width: 340, height: 340 }, 3);

console.log('\n已导出到 tools/shots/');
