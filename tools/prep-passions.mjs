/**
 * prep-passions.mjs — 把桌面上那三张「摄影 / 赛车 / 音乐」处理成网页素材
 *
 * 三张原图的共同点：背景都是纯黑，主体只占画面一部分，
 * 直接放进网页会看到大片空黑，像是没裁好。
 * 所以这里做两件事：
 *   1. 自动找出主体（亮度阈值 + 连通范围）的包围盒，
 *      再按目标比例扩成一个带边距的裁剪框 —— 主体始终居中、留白均匀；
 *   2. 输出 WebP 两档宽度，供 srcset 用。
 *
 * 三张统一裁成 4:5：比例一致 + 列间纵向错开，才是"排版有设计感"；
 * 三张各不相同的比例再叠加错开，看起来就只是乱。
 *
 * 用法: node tools/prep-passions.mjs
 */
import sharp from 'sharp';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';

const SRC = 'C:/Users/Lenovo/Desktop';
const OUT = 'assets/img';

// 目标比例（宽/高）与主体四周留白比例
const RATIO = 4 / 5;
const MARGIN = 0.10;

const JOBS = [
  // 摄影：纯黑底的产品图，自动找主体很好用
  { name: '摄影', file: 'passion-photography' },

  // 赛车：原图左下角烤了一行英文（还带着 "SHADOWTO" 的错字）。
  // 目测估了两次都没估准，最后用 tools/diag-text.mjs 把像素扫了一遍，
  // 量到那行字精确落在 x 60~824、y 1552~1590。
  // 所以裁剪框下沿卡在 1520（留 32px 余量），把那行字整条留在画面外；
  // 代价是车手的鞋（y≈1595）被切掉一点，那部分本来就在暗部，看不出来。
  {
    name: '赛车', file: 'passion-motorsport',
    box: { left: 614, top: 617, width: 722, height: 903 },
  },

  // 音乐：专辑封面，人脸占了大半张，阈值法会认为"整张都是主体"。
  // 而且左下角有专辑小字（"to be continued... 孫燕姿 未完成"），
  // 右对齐裁会把它切成半截"nued..."，很难看。
  // 手动框：上边贴顶、下边停在 1164（正好在小字上方），
  // 横向 507 起 —— 只切掉人脸左缘约 50px 的头发，五官和下巴都完整。
  {
    name: '音乐', file: 'passion-music',
    box: { left: 507, top: 0, width: 931, height: 1164 },
  },
];

await mkdir(OUT, { recursive: true });

for (const job of JOBS) {
  const src = `${SRC}/${job.name}.jpg`;
  if (!existsSync(src)) { console.error(`✗ 找不到 ${src}`); continue; }

  const img = sharp(src);
  const meta = await img.metadata();
  const { width: W, height: H } = meta;

  let cw, ch, left, top;

  if (job.box) {
    // 手动裁剪框：自动法在这些图上不可靠时用它（原因写在 JOBS 里）
    ({ left, top, width: cw, height: ch } = job.box);
    console.log(`\n${job.name}  原图 ${W}x${H}  （手动裁剪框）`);
  } else {
    // 缩小到 400px 宽再找主体：够准，又快
    const small = await img.clone().greyscale().resize({ width: 400 }).raw().toBuffer({ resolveWithObject: true });
    const sw = small.info.width, sh = small.info.height;
    let minX = sw, maxX = -1, minY = sh, maxY = -1;

    // 阈值取 42：远高于纯黑背景（个位数），又能抓住主体边缘的暗部
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

    // 换算回原图坐标
    const k = W / sw;
    let bx = minX * k, by = minY * k, bw = (maxX - minX + 1) * k, bh = (maxY - minY + 1) * k;
    // 四周留白
    bx -= bw * MARGIN; by -= bh * MARGIN;
    bw *= 1 + MARGIN * 2; bh *= 1 + MARGIN * 2;

    // 按目标比例扩框：以主体中心为中心，缺哪个方向补哪个方向
    const cx = bx + bw / 2, cy = by + bh / 2;
    cw = bw; ch = bh;
    if (cw / ch < RATIO) cw = ch * RATIO; else ch = cw / RATIO;

    // 贴到画布边界上（尽量不越界；越界了就整体推回来）
    left = Math.round(cx - cw / 2);
    top = Math.round(cy - ch / 2);
    cw = Math.min(Math.round(cw), W);
    ch = Math.min(Math.round(ch), H);
    left = Math.max(0, Math.min(left, W - cw));
    top = Math.max(0, Math.min(top, H - ch));

    console.log(`\n${job.name}  原图 ${W}x${H}`);
    console.log(`  主体包围盒(缩放后) x:${minX}-${maxX} y:${minY}-${maxY}`);
  }

  console.log(`  裁剪框 ${cw}x${ch} @ (${left},${top})  比例 ${(cw / ch).toFixed(3)} (目标 ${RATIO.toFixed(3)})`);

  for (const w of [520, 880]) {
    const out = `${OUT}/${job.file}-${w}.webp`;
    await sharp(src).extract({ left, top, width: cw, height: ch })
      .resize({ width: w })
      .webp({ quality: 82 })
      .toFile(out);
    const m = await sharp(out).metadata();
    const kb = (await import('node:fs')).statSync(out).size / 1024;
    console.log(`  ✓ ${out}  ${m.width}x${m.height}  ${kb.toFixed(0)}KB`);
  }
}
