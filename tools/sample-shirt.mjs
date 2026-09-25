/**
 * sample-shirt.mjs — 量「任恺昱」所在区域的 T 恤颜色是否够均匀
 *
 * 用途：给名字加填充层来盖住内部交叉线时，填充色必须和底下的衣服对得上。
 * 衣服够均匀 → 用一个纯色填充就行；差异大 → 得用别的手段（把照片本身
 * 当作填充的 background-clip:text）。
 *
 * 用法: node tools/sample-shirt.mjs [图片]
 */
import sharp from 'sharp';

const SRC = process.argv[2] || 'src/portrait-1400.webp';
const { data, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { width: W, channels: CH } = info;

// 「任恺昱」在人物图坐标系里的范围（由首屏布局换算得来）
const REGION = { left: 71, top: 1021, right: 1041, bottom: 1339 };
// 再往里收一点，避开衣服边缘和褶皱最重的地方
const INNER = { left: 180, top: 1100, right: 930, bottom: 1300 };

function statsOf(r) {
  let n = 0, sr = 0, sg = 0, sb = 0, sr2 = 0, sg2 = 0, sb2 = 0;
  let mn = [255, 255, 255], mx = [0, 0, 0];
  for (let y = r.top; y < r.bottom; y += 2) {
    for (let x = r.left; x < r.right; x += 2) {
      const i = (y * W + x) * CH;
      if (data[i + 3] < 200) continue;
      const c = [data[i], data[i + 1], data[i + 2]];
      n++;
      sr += c[0]; sg += c[1]; sb += c[2];
      sr2 += c[0] * c[0]; sg2 += c[1] * c[1]; sb2 += c[2] * c[2];
      for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], c[k]); mx[k] = Math.max(mx[k], c[k]); }
    }
  }
  const mean = [sr / n, sg / n, sb / n];
  const sd = [
    Math.sqrt(Math.max(0, sr2 / n - mean[0] ** 2)),
    Math.sqrt(Math.max(0, sg2 / n - mean[1] ** 2)),
    Math.sqrt(Math.max(0, sb2 / n - mean[2] ** 2)),
  ];
  return { n, mean, sd, mn, mx };
}

console.log(`\n图片: ${SRC}  ${W}x${info.height}`);
console.log(`名字区域（人物图坐标）: x ${REGION.left}~${REGION.right}, y ${REGION.top}~${REGION.bottom}\n`);

for (const [label, r] of [['整个名字区域', REGION], ['内缩后的核心区', INNER]]) {
  const s = statsOf(r);
  console.log(`${label}  (${s.n} 个采样点)`);
  console.log(`  平均色: rgb(${s.mean.map(v => v.toFixed(0)).join(', ')})`);
  console.log(`  标准差: ${s.sd.map(v => v.toFixed(1)).join(' / ')}`);
  console.log(`  取值范围: R ${s.mn[0]}~${s.mx[0]}  G ${s.mn[1]}~${s.mx[1]}  B ${s.mn[2]}~${s.mx[2]}`);
  const maxSd = Math.max(...s.sd);
  console.log(`  → ${maxSd < 8 ? '✓ 很均匀，纯色填充足够' : maxSd < 18 ? '⚠ 略有渐变，纯色填充会有轻微可见边界' : '✗ 差异明显，纯色填充会露馅'}\n`);
}
