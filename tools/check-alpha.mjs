/**
 * check-alpha.mjs — 检查一张图是否本来就已经有透明通道
 * 用法: node tools/check-alpha.mjs <图片>
 */
import sharp from 'sharp';

const SRC = process.argv[2];
const { data, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { width: W, height: H, channels: CH } = info;

console.log(`\n${SRC}  ${W}x${H}  通道数=${CH}`);

const meta = await sharp(SRC).metadata();
console.log(`  原图格式: ${meta.format}  是否带 alpha: ${meta.hasAlpha}`);

// 边界像素的 alpha 分布
let borderTotal = 0, borderTransparent = 0;
const sample = (x, y) => {
  const i = (y * W + x) * CH;
  borderTotal++;
  if (data[i + 3] < 8) borderTransparent++;
};
for (let x = 0; x < W; x++) { sample(x, 0); sample(x, H - 1); }
for (let y = 0; y < H; y++) { sample(0, y); sample(W - 1, y); }

console.log(`  边界像素: ${borderTotal} 个，其中完全透明 ${borderTransparent} 个 (${(borderTransparent / borderTotal * 100).toFixed(1)}%)`);

// 全图 alpha 分布
let zero = 0, full = 0, semi = 0;
for (let i = 3; i < data.length; i += 4) {
  if (data[i] < 8) zero++; else if (data[i] > 247) full++; else semi++;
}
const t = W * H;
console.log(`  全图 alpha: 透明 ${(zero / t * 100).toFixed(1)}% | 不透明 ${(full / t * 100).toFixed(1)}% | 半透明 ${(semi / t * 100).toFixed(1)}%`);

// 边界透明像素的 RGB 是什么（这决定了"自动判背景色"会不会被带偏）
const i0 = 0;
console.log(`  左上角像素 RGBA = (${data[0]}, ${data[1]}, ${data[2]}, ${data[3]})`);

console.log('');
if (borderTransparent / borderTotal > 0.9) {
  console.log('  → 结论：这张图【本来就是透明背景】，不需要抠图。');
  console.log('     直接缩放/压缩即可；再跑一遍抠图只会把主体啃坏。');
} else {
  console.log('  → 结论：背景不透明，需要抠图。');
}
