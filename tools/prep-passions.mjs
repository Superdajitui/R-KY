/**
 * prep-passions.mjs — 把 src/ 里那三张「摄影 / 赛车 / 音乐」处理成网页素材
 *
 * 排版改成了"一行图片一行文字、左右交错"，每行的图片占半幅宽，
 * 所以三张统一裁成 1:1（正方形）：
 *   - 摄影的相机在这张竖图里几乎是满高的，裁成横向比例会切掉机身；
 *   - 赛车是竖图，1:1 正好装下整条速度线；
 *   - 音乐本身就是方的，几乎不用动。
 *   统一 1:1 是唯一同时满足三张原图的比例。
 *
 * 用法: node tools/prep-passions.mjs
 */
import sharp from 'sharp';
import { existsSync, statSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';

const SRC = 'src';
const OUT = 'assets/img';

const RATIO = 1;        // 宽/高
const MARGIN = 0.08;    // 主体四周留白
const SIZES = [700, 1100];

const JOBS = [
  // 摄影、赛车都是"纯黑底 + 主体"的图，自动找主体包围盒很准。
  // （赛车原图那行烤进去的英文小字，用户已经在新版里删掉了，
  //   所以这里不再需要手动框。）
  { name: '摄影', file: 'passion-photography', src: 'passion-photography-src.jpg' },
  { name: '赛车', file: 'passion-motorsport', src: 'passion-motorsport-src.jpg' },

  // 音乐是专辑封面，人脸占了大半张，亮度阈值法会认为"整张都是主体"，
  // 自动裁剪等于没裁。直接按中心裁成 1:1 —— 原图本来就接近正方形。
  { name: '音乐', file: 'passion-music', src: 'passion-music-src.jpg', mode: 'center' },
];

await mkdir(OUT, { recursive: true });

for (const job of JOBS) {
  const src = `${SRC}/${job.src}`;
  if (!existsSync(src)) { console.error(`✗ 找不到 ${src}`); continue; }

  const img = sharp(src);
  const meta = await img.metadata();
  const { width: W, height: H } = meta;

  let cw, ch, left, top;

  if (job.mode === 'center') {
    // 中心裁成目标比例
    if (W / H > RATIO) { ch = H; cw = Math.round(H * RATIO); }
    else { cw = W; ch = Math.round(W / RATIO); }
    left = Math.round((W - cw) / 2);
    top = Math.round((H - ch) / 2);
    console.log(`\n${job.name}  原图 ${W}x${H}  （中心裁剪）`);
  } else {
    // 缩到 400px 宽找主体：够准，又快
    const small = await img.clone().greyscale().resize({ width: 400 }).raw().toBuffer({ resolveWithObject: true });
    const sw = small.info.width, sh = small.info.height;
    let minX = sw, maxX = -1, minY = sh, maxY = -1;

    // 阈值 42：远高于纯黑背景（个位数），又能抓住主体边缘的暗部
    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < sw; x++) {
        if (small.data[y * sw + x] > 42) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0) { console.error(`✗ ${job.name}: 没找到主体`); continue; }

    const k = W / sw;
    let bx = minX * k, by = minY * k, bw = (maxX - minX + 1) * k, bh = (maxY - minY + 1) * k;
    bx -= bw * MARGIN; by -= bh * MARGIN;
    bw *= 1 + MARGIN * 2; bh *= 1 + MARGIN * 2;

    // 以主体中心为中心，按目标比例扩框
    const cx = bx + bw / 2, cy = by + bh / 2;
    cw = bw; ch = bh;
    if (cw / ch < RATIO) cw = ch * RATIO; else ch = cw / RATIO;

    cw = Math.min(Math.round(cw), W);
    ch = Math.min(Math.round(ch), H);
    left = Math.max(0, Math.min(Math.round(cx - cw / 2), W - cw));
    top = Math.max(0, Math.min(Math.round(cy - ch / 2), H - ch));
    console.log(`\n${job.name}  原图 ${W}x${H}`);
    console.log(`  主体包围盒(缩放后) x:${minX}-${maxX} y:${minY}-${maxY}`);
  }

  console.log(`  裁剪框 ${cw}x${ch} @ (${left},${top})  比例 ${(cw / ch).toFixed(3)} (目标 ${RATIO.toFixed(3)})`);

  for (const w of SIZES) {
    const out = `${OUT}/${job.file}-${w}.webp`;
    await sharp(src).extract({ left, top, width: cw, height: ch })
      .resize({ width: w })
      .webp({ quality: 82 })
      .toFile(out);
    const m = await sharp(out).metadata();
    console.log(`  ✓ ${out}  ${m.width}x${m.height}  ${(statSync(out).size / 1024).toFixed(0)}KB`);
  }
}
