/**
 * cutout.mjs — 证件照去背工具
 *
 * 思路：
 *  1. 四条边框带里挑「颜色最均匀」的一条作为背景参考色 —— 证件照的背景
 *     必然比主体（衣服/头发）平整，所以方差最小的那条边就是背景。
 *     这样不会像「四边取平均」那样被底部的深色衣服带偏。
 *  2. 从四周边框泛洪（region growing），只吃掉与画面边缘连通的背景，
 *     脸部高光之类的白点不会被误伤成透明洞。
 *  3. 相邻像素用「局部容差」比较，全局用「参考背景色容差」约束，
 *     轻微渐变/暗角也能被完整吃掉。
 *  4. 只在与边界相距 FEATHER_BAND 像素以内做 alpha 羽化，保住发丝；
 *     主体内部硬性 alpha=1 —— 这一步若算错，去白边的除法会把肤色算歪。
 *  5. 对半透明像素做 unmultiply（去白边），避免深色背景上出现白色描边。
 *  6. 自动裁掉四周全透明的空白，让主体占满画布。
 *
 * 用法: node tools/cutout.mjs <输入图> <输出目录>
 */
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const [, , IN, OUTDIR] = process.argv;
if (!IN || !OUTDIR) {
  console.error('用法: node tools/cutout.mjs <输入图> <输出目录>');
  process.exit(1);
}

// ---- 可调参数 ----------------------------------------------------------
const T_GLOBAL = 52;    // 与参考背景色的最大加权距离
const T_LOCAL = 16;     // 与已判定为背景的邻接像素的最大加权距离
const SAT_MARGIN = 0.09;// 背景容许的额外饱和度（背景自身饱和度 + 此余量）
const OPEN_RADIUS = 3;  // 形态学开运算半径，用来清掉渗进主体的背景细缝
const FEATHER_LO = 30;  // 颜色距离 <= 此值 => alpha 视为 0
const FEATHER_HI = 120; // 颜色距离 >= 此值 => alpha 视为 1
const ALPHA_FLOOR = 0.08;       // 低于此 alpha 直接归零，清掉雾状残留
const SUBJECT_MIN_ALPHA = 0.55; // 羽化带内主体像素的最低不透明度
const FEATHER_BAND = 3;         // 羽化带宽度(px)
const TRIM_PAD = 6;             // 裁剪时四周保留的内边距(px)
// -----------------------------------------------------------------------

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lum = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
const satOf = (r, g, b) => {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  return mx === 0 ? 0 : (mx - mn) / mx;
};
const dist = (r1, g1, b1, r2, g2, b2) => {
  const dr = r1 - r2, dg = g1 - g2, db = b1 - b2;
  return Math.sqrt(0.3 * dr * dr + 0.59 * dg * dg + 0.11 * db * db);
};

const image = sharp(IN).ensureAlpha();
const meta = await image.metadata();
const { width: W, height: H } = meta;
const { data: src } = await image.raw().toBuffer({ resolveWithObject: true });
const CH = 4;

console.log(`输入: ${path.basename(IN)}  ${W}x${H}`);

// --- 1. 选背景参考色：四条边框带里方差最小的那条 -----------------------
const BAND = Math.max(2, Math.round(Math.min(W, H) * 0.012));

function scanBand(name, getXY, count) {
  let sr = 0, sg = 0, sb = 0, sl = 0, sl2 = 0;
  for (let k = 0; k < count; k++) {
    const [x, y] = getXY(k);
    const i = (y * W + x) * CH;
    const r = src[i], g = src[i + 1], b = src[i + 2];
    sr += r; sg += g; sb += b;
    const L = lum(r, g, b);
    sl += L; sl2 += L * L;
  }
  const mean = sl / count;
  return {
    name,
    r: sr / count, g: sg / count, b: sb / count,
    sd: Math.sqrt(Math.max(0, sl2 / count - mean * mean)),
  };
}

const bands = [];
for (let d = 0; d < BAND; d++) {
  bands.push(scanBand(`顶边+${d}`, k => [k, d], W));
  bands.push(scanBand(`底边-${d}`, k => [k, H - 1 - d], W));
  bands.push(scanBand(`左边+${d}`, k => [d, k], H));
  bands.push(scanBand(`右边-${d}`, k => [W - 1 - d, k], H));
}

console.log('\n各边框带均匀度（标准差越小越像背景）:');
const bySd = [...bands].sort((a, b) => a.sd - b.sd);
bySd.slice(0, 3).forEach(b =>
  console.log(`  ${b.name.padEnd(9)} sd=${b.sd.toFixed(1).padStart(6)}  rgb(${b.r.toFixed(0)},${b.g.toFixed(0)},${b.b.toFixed(0)})`));

const ref = bySd[0];
const bgR = ref.r, bgG = ref.g, bgB = ref.b;
const satMax = satOf(bgR, bgG, bgB) + SAT_MARGIN;
console.log(`\n选定背景参考色: rgb(${bgR.toFixed(0)}, ${bgG.toFixed(0)}, ${bgB.toFixed(0)})  (来自 ${ref.name})`);
console.log(`背景饱和度 ${satOf(bgR, bgG, bgB).toFixed(3)}，容许上限 ${satMax.toFixed(3)}`);

// --- 2. 从边缘泛洪 ------------------------------------------------------
const isBg = new Uint8Array(W * H);
const queue = new Int32Array(W * H);
let qh = 0, qt = 0;

const tryPush = (x, y, fromX, fromY) => {
  const p = y * W + x;
  if (isBg[p]) return;
  const i = p * CH;
  const r = src[i], g = src[i + 1], b = src[i + 2];
  if (dist(r, g, b, bgR, bgG, bgB) > T_GLOBAL) return; // 必须接近全局背景色

  // 还必须是"灰/白"的低饱和像素。
  // 这条是关键：只靠颜色距离的话，头发与耳朵交界处的抗锯齿渐变
  // 同样满足"距离<=52"，泛洪会顺着这条渐变一路啃进耳朵，
  // 表现为耳朵上缘被咬掉一块锯齿状缺口。白底饱和度是 0，皮肤是 20+。
  if (satOf(r, g, b) > satMax) return;

  if (fromX >= 0) {                                    // 且相对邻接背景像素不能突变
    const j = (fromY * W + fromX) * CH;
    if (dist(r, g, b, src[j], src[j + 1], src[j + 2]) > T_LOCAL) return;
  }
  isBg[p] = 1;
  queue[qt++] = p;
};

for (let x = 0; x < W; x++) { tryPush(x, 0, -1, -1); tryPush(x, H - 1, -1, -1); }
for (let y = 0; y < H; y++) { tryPush(0, y, -1, -1); tryPush(W - 1, y, -1, -1); }

while (qh < qt) {
  const p = queue[qh++];
  const x = p % W, y = (p / W) | 0;
  if (x > 0) tryPush(x - 1, y, x, y);
  if (x < W - 1) tryPush(x + 1, y, x, y);
  if (y > 0) tryPush(x, y - 1, x, y);
  if (y < H - 1) tryPush(x, y + 1, x, y);
}
const bgPct = (qt / (W * H)) * 100;
console.log(`泛洪背景像素: ${qt} / ${W * H}  (${bgPct.toFixed(1)}%)`);
if (bgPct < 5) console.error('⚠ 背景占比过低，抠图可能失败');
if (bgPct > 92) console.error('⚠ 背景占比过高，主体可能被吃掉了');

// --- 2b. 形态学开运算：清掉渗进主体的背景细缝 --------------------------
// 泛洪仍可能顺着某些抗锯齿路径钻进主体，留下细细的"咬痕"。
// 对背景掩膜做「先腐蚀后膨胀」(开运算)：比 2*OPEN_RADIUS 还窄的背景
// 突起会消失，而大块背景区域膨胀回来后尺寸不变。
function morphPass(mask, r, dilate) {
  const tmp = new Uint8Array(W * H);
  const res = new Uint8Array(W * H);
  // 横向
  for (let y = 0; y < H; y++) {
    const row = y * W;
    for (let x = 0; x < W; x++) {
      let v = dilate ? 0 : 1;
      const a = Math.max(0, x - r), b = Math.min(W - 1, x + r);
      for (let k = a; k <= b; k++) {
        if (dilate) { if (mask[row + k]) { v = 1; break; } }
        else { if (!mask[row + k]) { v = 0; break; } }
      }
      tmp[row + x] = v;
    }
  }
  // 纵向
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) {
      let v = dilate ? 0 : 1;
      const a = Math.max(0, y - r), b = Math.min(H - 1, y + r);
      for (let k = a; k <= b; k++) {
        if (dilate) { if (tmp[k * W + x]) { v = 1; break; } }
        else { if (!tmp[k * W + x]) { v = 0; break; } }
      }
      res[y * W + x] = v;
    }
  }
  return res;
}

const beforeOpen = isBg.reduce((s, v) => s + v, 0);
const eroded = morphPass(isBg, OPEN_RADIUS, false);
const opened = morphPass(eroded, OPEN_RADIUS, true);
isBg.set(opened);
const afterOpen = isBg.reduce((s, v) => s + v, 0);
console.log(`开运算(r=${OPEN_RADIUS}): 背景像素 ${beforeOpen} -> ${afterOpen} ` +
  `(清掉 ${beforeOpen - afterOpen} 个渗入主体的杂点)`);

// --- 3. 求「离背景的步数」和「离主体的步数」，划定羽化带 ---------------
const distToBg = new Int16Array(W * H).fill(-1);
const distToFg = new Int16Array(W * H).fill(-1);

function bfs(isSeed, field) {
  const q = new Int32Array(W * H);
  let h = 0, t = 0;
  for (let p = 0; p < W * H; p++) {
    if (isSeed(p)) { field[p] = 0; q[t++] = p; }
  }
  while (h < t) {
    const p = q[h++];
    const d = field[p];
    if (d >= FEATHER_BAND) continue; // 只向外扩散 FEATHER_BAND 步
    const x = p % W, y = (p / W) | 0;
    if (x > 0 && field[p - 1] === -1) { field[p - 1] = d + 1; q[t++] = p - 1; }
    if (x < W - 1 && field[p + 1] === -1) { field[p + 1] = d + 1; q[t++] = p + 1; }
    if (y > 0 && field[p - W] === -1) { field[p - W] = d + 1; q[t++] = p - W; }
    if (y < H - 1 && field[p + W] === -1) { field[p + W] = d + 1; q[t++] = p + W; }
  }
}
bfs(p => isBg[p] === 1, distToBg);
bfs(p => isBg[p] === 0, distToFg);

// --- 4. 计算 alpha ------------------------------------------------------
const out = Buffer.alloc(W * H * CH);
let semi = 0;
for (let p = 0; p < W * H; p++) {
  const i = p * CH;
  const r = src[i], g = src[i + 1], b = src[i + 2];
  const d = dist(r, g, b, bgR, bgG, bgB);

  let a;
  if (isBg[p]) {
    // 背景区：只有紧贴主体的那一圈做软过渡，其余全透明
    a = (distToFg[p] >= 0 && distToFg[p] <= FEATHER_BAND)
      ? clamp((d - FEATHER_LO) / (FEATHER_HI - FEATHER_LO), 0, 1)
      : 0;
  } else {
    // 主体区：边界一圈按颜色距离羽化以保住发丝，内部一律不透明
    a = (distToBg[p] >= 0 && distToBg[p] <= FEATHER_BAND)
      ? Math.max(clamp((d - FEATHER_LO) / (FEATHER_HI - FEATHER_LO), 0, 1), SUBJECT_MIN_ALPHA)
      : 1;
  }
  if (a < ALPHA_FLOOR) a = 0;
  if (a > 0 && a < 1) semi++;

  // --- 5. unmultiply 去白边（只作用于羽化带里的半透明像素）---
  let or = r, og = g, ob = b;
  if (a > 0.02 && a < 0.995) {
    or = clamp((r - (1 - a) * bgR) / a, 0, 255);
    og = clamp((g - (1 - a) * bgG) / a, 0, 255);
    ob = clamp((b - (1 - a) * bgB) / a, 0, 255);
  }

  out[i] = or; out[i + 1] = og; out[i + 2] = ob;
  out[i + 3] = Math.round(a * 255);
}
console.log(`半透明(羽化)像素: ${semi}`);

// --- 6. 自动裁剪透明边距 ------------------------------------------------
let minX = W, minY = H, maxX = -1, maxY = -1;
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    if (out[(y * W + x) * CH + 3] > 8) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
}
minX = Math.max(0, minX - TRIM_PAD); minY = Math.max(0, minY - TRIM_PAD);
maxX = Math.min(W - 1, maxX + TRIM_PAD); maxY = Math.min(H - 1, maxY + TRIM_PAD);
const cw = maxX - minX + 1, chh = maxY - minY + 1;
console.log(`裁剪透明边距: ${W}x${H} -> ${cw}x${chh}  @(${minX},${minY})`);

const cropped = Buffer.alloc(cw * chh * CH);
for (let y = 0; y < chh; y++) {
  out.copy(cropped, y * cw * CH, ((y + minY) * W + minX) * CH, ((y + minY) * W + minX + cw) * CH);
}

// --- 6b. 底部渐隐：把淡出直接烤进图片的 alpha 通道 ---
// 原先用 CSS mask-image 做这件事，但 mask + filter + mix-blend-mode 叠在
// 同一个元素上时，个别浏览器/驱动组合会把整块渲染成空白。
// 烤进像素里就完全不依赖这些特性了，而且运行时还更省。
const FADE_START = 0.74;  // 从这里开始淡出（与原来的 CSS mask 位置一致）
const fadeFrom = Math.round(chh * FADE_START);
for (let y = fadeFrom; y < chh; y++) {
  const t = (y - fadeFrom) / Math.max(1, chh - 1 - fadeFrom); // 0 -> 1
  // 缓入曲线，避免出现明显的"分界线"
  const k = 1 - Math.pow(t, 1.35);
  for (let x = 0; x < cw; x++) {
    const i = (y * cw + x) * CH + 3;
    cropped[i] = Math.round(cropped[i] * k);
  }
}
console.log(`底部渐隐: 从 ${fadeFrom}/${chh} 行开始`);

// --- 7. 输出 ------------------------------------------------------------
await mkdir(OUTDIR, { recursive: true });
const base = sharp(cropped, { raw: { width: cw, height: chh, channels: CH } });

// PNG 只作为不支持 WebP 时的兜底。
// 带 alpha 的真彩 PNG 极占体积，这里降到 1000px 并做调色板量化。
await base.clone().resize({ height: 1000, fit: 'inside' })
  .png({ compressionLevel: 9, palette: true, quality: 88, effort: 8 })
  .toFile(path.join(OUTDIR, 'portrait.png'));
// 桌面主图
await base.clone().resize({ height: 1400, fit: 'inside' })
  .webp({ quality: 92, alphaQuality: 100 }).toFile(path.join(OUTDIR, 'portrait-1400.webp'));
// 窄屏用（移动端按 2~3 倍 DPR 算，900px 高足够，省一半流量）
await base.clone().resize({ height: 900, fit: 'inside' })
  .webp({ quality: 90, alphaQuality: 100 }).toFile(path.join(OUTDIR, 'portrait-900.webp'));

// --- 8. 双色调版本（黑 -> 霓虹绿），用于 hover 效果 ---------------------
const duo = Buffer.alloc(cw * chh * CH);
const NEON = [210, 255, 0]; // #D2FF00
for (let p = 0; p < cw * chh; p++) {
  const i = p * CH;
  const a = cropped[i + 3];
  if (a === 0) continue;
  const L = lum(cropped[i], cropped[i + 1], cropped[i + 2]) / 255;
  const t = Math.pow(clamp((L - 0.10) / 0.70, 0, 1), 0.8);
  duo[i] = Math.round(NEON[0] * t);
  duo[i + 1] = Math.round(NEON[1] * t);
  duo[i + 2] = Math.round(NEON[2] * t);
  duo[i + 3] = a;
}
await sharp(duo, { raw: { width: cw, height: chh, channels: CH } })
  .resize({ height: 1100, fit: 'inside' })
  .webp({ quality: 88, alphaQuality: 100 })
  .toFile(path.join(OUTDIR, 'portrait-duotone.webp'));

console.log('\n输出完成 ->', OUTDIR);
