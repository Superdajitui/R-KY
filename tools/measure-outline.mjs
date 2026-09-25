/**
 * measure-outline.mjs — 量镂空描边的实际粗细
 *
 * 为什么要量而不是靠看：
 *   paint-order / ::after 这类叠层写法很容易让描边凭空变细或变粗 ——
 *   上一版用 paint-order:stroke fill，填充盖掉了描边的内半部分，
 *   桌面上 2px 变成了 1px，肉眼一看才发现。
 *
 * 做法：把镂空那行截出来，沿若干条水平线扫描，
 * 统计连续深色像素的长度（即描边经过竖直笔画时的粗细）。
 *
 * 用法: node tools/measure-outline.mjs [图片]
 */
import sharp from 'sharp';

const SRC = process.argv[2] || 'tools/shots/shot-desktop-0-welcome.png';

// 镂空那行在开场页的位置（1440x900 截图内）
const CROP = { left: 50, top: 500, width: 700, height: 130 };

const { data, info } = await sharp(SRC)
  .extract(CROP)
  .raw()
  .toBuffer({ resolveWithObject: true });

const { width: W, height: H, channels: CH } = info;
const isInk = (x, y) => {
  const i = (y * W + x) * CH;
  return data[i] < 110 && data[i + 1] < 110 && data[i + 2] < 110;   // 深色 = 描边
};

// 扫描所有水平线，统计"深色连续段"的长度分布。
// 竖直笔画被横切时会形成一段短促的深色；段长就是描边粗细。
const runs = [];
for (let y = 2; y < H - 2; y += 2) {
  let run = 0;
  for (let x = 1; x < W - 1; x++) {
    if (isInk(x, y)) run++;
    else {
      // 只统计 1~8px 的短段：再长就不是描边，而是笔画本身或字符之间的实心区
      if (run >= 1 && run <= 8) runs.push(run);
      run = 0;
    }
  }
}

runs.sort((a, b) => a - b);
const pick = (p) => runs[Math.floor(runs.length * p)] || 0;
const mean = runs.reduce((a, b) => a + b, 0) / (runs.length || 1);

console.log(`\n图片: ${SRC}`);
console.log(`裁切区域: ${JSON.stringify(CROP)}`);
console.log(`\n描边横切段长（共 ${runs.length} 段）:`);
console.log(`  中位数: ${pick(0.5)} px`);
console.log(`  平均值: ${mean.toFixed(2)} px`);
console.log(`  25%~75%: ${pick(0.25)} ~ ${pick(0.75)} px`);

const med = pick(0.5);
console.log('');
if (med <= 0) {
  console.log('  ✗ 没量到描边 —— 裁切区域可能不对，或者描边根本没渲染出来');
  process.exit(1);
} else if (med < 1.5) {
  console.log(`  ⚠ 描边偏细（中位数 ${med}px）。目标约 2px`);
} else if (med > 4) {
  console.log(`  ⚠ 描边偏粗（中位数 ${med}px）。目标约 2px`);
} else {
  console.log(`  ✓ 描边粗细正常（中位数 ${med}px，目标约 2px）`);
}
