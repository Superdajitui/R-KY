/**
 * find-collar.mjs — 找出人物图里衣领的位置
 *
 * 用途：首屏「任恺昱」三个字要压在衣服上、但不能盖到脖子和下巴。
 * 硬编码一个 bottom 值是靠猜，这里直接扫像素把衣领线量出来。
 *
 * 做法：沿人物中轴从上往下扫，依次经过
 *   下巴(肤色) → 脖子(肤色) → 衣领(深色T恤)
 * 找到从肤色转为深色的那一行，就是衣领上缘。
 *
 * 用法: node tools/find-collar.mjs [图片]
 */
import sharp from 'sharp';

const SRC = process.argv[2] || 'src/portrait-1400.webp';
const { data, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { width: W, height: H, channels: CH } = info;

console.log(`\n人物图: ${SRC}  ${W}x${H}`);

// 沿中轴附近取几列求平均，避免被衣领的曲线或高光干扰
const COLS = [W * 0.42, W * 0.5, W * 0.58].map(Math.round);

/** 某一行的平均亮度（只统计不透明像素） */
function rowLuma(y) {
  let sum = 0, n = 0;
  for (const x of COLS) {
    for (let dx = -6; dx <= 6; dx++) {
      const i = (y * W + (x + dx)) * CH;
      if (data[i + 3] < 200) continue;                 // 透明像素不算
      sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      n++;
    }
  }
  return n ? sum / n : -1;
}

// 打印中段的亮度剖面，看清结构
console.log('\n中轴亮度剖面（每 25 行）:');
for (let y = 700; y <= 1200; y += 25) {
  const L = rowLuma(y);
  const bar = L < 0 ? '（透明）' : '█'.repeat(Math.round(L / 8));
  console.log(`  y=${String(y).padStart(4)}  ${L < 0 ? '  -  ' : L.toFixed(0).padStart(4)}  ${bar}`);
}

// 自动找衣领：从 y=800（下巴附近）往下，第一行亮度跌破阈值的
let collar = null;
const THRESHOLD = 90;
for (let y = 820; y < H - 1; y++) {
  if (rowLuma(y) < THRESHOLD) {
    // 连续 20 行都暗才算真的进衣服了，避免被阴影或高光误判
    let ok = true;
    for (let k = 1; k <= 20; k++) if (rowLuma(y + k) >= THRESHOLD) { ok = false; break; }
    if (ok) { collar = y; break; }
  }
}

console.log('');
if (collar) {
  console.log(`  ✓ 衣领上缘: y = ${collar}  (占图高 ${(collar / H * 100).toFixed(1)}%)`);
} else {
  console.log('  ✗ 没找到衣领，阈值可能不合适');
  process.exit(1);
}
