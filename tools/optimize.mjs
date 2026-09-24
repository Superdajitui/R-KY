/**
 * optimize.mjs — 处理【本来就带透明通道】的素材
 *
 * 和 cutout.mjs 的分工：
 *   cutout.mjs    背景不透明（比如白底证件照）→ 抠掉背景
 *   optimize.mjs  背景已经是透明的（比如下载的 PNG/WebP）→ 只缩放压缩
 *
 * 用法:
 *   node tools/optimize.mjs <输入图> <输出目录> --name=helmet --sizes=800,500
 */
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const positional = process.argv.slice(2).filter(a => !a.startsWith('--'));
const IN = positional[0];
const OUTDIR = positional[1];
if (!IN || !OUTDIR) {
  console.error('用法: node tools/optimize.mjs <输入图> <输出目录> --name=helmet --sizes=800,500');
  process.exit(1);
}
const arg = (k, d) => {
  const hit = process.argv.slice(2).find(a => a.startsWith(`--${k}=`));
  return hit ? hit.split('=').slice(1).join('=') : d;
};
const NAME = arg('name', 'image');
const SIZES = arg('sizes', '').split(',').map(Number).filter(Boolean);
const TRIM = !process.argv.includes('--no-trim');
const PAD = Number(arg('pad', '0'));

await mkdir(OUTDIR, { recursive: true });

let pipeline = sharp(IN).ensureAlpha();
const meta = await sharp(IN).metadata();
console.log(`\n输入: ${path.basename(IN)}  ${meta.width}x${meta.height}  原格式 ${meta.format}  alpha=${meta.hasAlpha}`);

// 裁掉四周多余的透明边距，方便在页面上做定位
if (TRIM) {
  pipeline = sharp(await pipeline.png().toBuffer()).trim({ threshold: 1 });
  if (PAD > 0) {
    const buf = await pipeline.png().toBuffer();
    const m = await sharp(buf).metadata();
    pipeline = sharp(buf).extend({
      top: PAD, bottom: PAD, left: PAD, right: PAD,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    });
    console.log(`  裁掉透明边距并留出 ${PAD}px 内边距`);
  } else {
    console.log('  已裁掉四周透明边距');
  }
}

const trimmed = await pipeline.png().toBuffer();
const tm = await sharp(trimmed).metadata();
console.log(`  处理后尺寸: ${tm.width}x${tm.height}`);

// 输出多档尺寸，页面上按需取用
const targets = SIZES.length ? SIZES : [tm.height];
const seen = new Set();
for (const h of targets) {
  const height = Math.min(h, tm.height);
  if (seen.has(height)) continue;
  seen.add(height);
  const suffix = height === tm.height ? '' : `-${height}`;
  const out = path.join(OUTDIR, `${NAME}${suffix}.webp`);
  await sharp(trimmed).resize({ height, fit: 'inside' })
    .webp({ quality: 92, alphaQuality: 100 }).toFile(out);
  const st = await sharp(out).metadata();
  const kb = (await import('node:fs')).statSync(out).size / 1024;
  console.log(`  ✓ ${path.basename(out)}  ${st.width}x${st.height}  ${kb.toFixed(1)} KB`);
}

// PNG 兜底
const png = path.join(OUTDIR, `${NAME}.png`);
await sharp(trimmed).resize({ height: Math.min(800, tm.height), fit: 'inside' })
  .png({ compressionLevel: 9, palette: true, quality: 88, effort: 8 }).toFile(png);
console.log(`  ✓ ${path.basename(png)}  (${((await import('node:fs')).statSync(png).size / 1024).toFixed(1)} KB)`);

console.log('\n完成 ->', OUTDIR);
