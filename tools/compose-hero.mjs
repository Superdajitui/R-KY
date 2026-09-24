/**
 * compose-hero.mjs — 生成首屏人物图
 *
 * 两种模式：
 *   默认       把头盔合成到人物照片上
 *   --no-helmet 只输出人物原图（去掉头盔）
 *
 * 为什么离线合成而不是在 CSS 里叠两层：
 *   流体效果要用 WebGL 做，把结果烤成一张贴图后，shader 只需要采样
 *   一张纹理，逻辑简单、性能也好。分两层的话 shader 里还得处理叠加顺序。
 *
 * 用法:
 *   node tools/compose-hero.mjs --no-helmet
 *   node tools/compose-hero.mjs --h=780 --cx=570 --top=58
 */
import sharp from 'sharp';
import { statSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// 源素材放在 src/，不参与部署；assets/ 只放网页真正会请求的文件。
// 否则头盔原图、未合成的抠像图都会被一起打包上线，白白多传一兆。
const PORTRAIT = 'src/portrait-1400.webp';
const HELMET   = 'src/helmet.webp';

/**
 * @param {object} o
 * @param {boolean} o.helmet  是否戴头盔（false = 只输出人物原图）
 * @param {number} o.h        头盔高度(px)   —— 人物图 1115x1400，发顶 y=13、下巴 y=828、头心 x=570
 * @param {number} o.cx       头盔中心 x
 * @param {number} o.top      头盔顶部 y
 * @param {number} o.rot      旋转角度(度)
 * @param {number} o.opacity  头盔不透明度
 * @param {string} o.out      输出路径前缀
 * @param {boolean} o.silent  不打印日志
 */
export async function composeHelmet({
  helmet = true,
  h = 780, cx = 570, top = 58, rot = 0, opacity = 1,
  out = 'assets/img/hero-composite', silent = false,
} = {}) {
  const log = (...a) => { if (!silent) console.log(...a); };

  const pm = await sharp(PORTRAIT).metadata();
  log(`人物图: ${pm.width}x${pm.height}`);

  let base;

  if (!helmet) {
    log('模式: 去掉头盔，直接输出人物原图');
    base = await sharp(PORTRAIT).webp({ quality: 92, alphaQuality: 100 }).toBuffer();
  } else {
    log(`头盔参数: 高 ${h}px, 中心 x=${cx}, 顶 y=${top}, 旋转 ${rot}°, 不透明度 ${opacity}`);

    const scaled = await sharp(HELMET).resize({ height: h, fit: 'inside' }).toBuffer();
    let sm = await sharp(scaled).metadata();

    // 旋转：先按"旋转后包围盒"的精确增量留白，转完再裁掉透明边回到紧凑包围盒。
    // 踩过的坑：一开始图省事留 40% 边距，结果叠加层涨到 1415x1440，比底图
    // 1115x1400 还大，而 sharp 的 composite 不允许叠加层大于底图，直接报
    // "Image to composite must have same dimensions or smaller"。
    let helmetBuf = scaled;
    if (rot !== 0) {
      const rad = Math.abs(rot) * Math.PI / 180;
      const cos = Math.cos(rad), sin = Math.sin(rad);
      const newW = sm.width * cos + sm.height * sin;
      const newH = sm.width * sin + sm.height * cos;
      const padX = Math.ceil((newW - sm.width) / 2) + 2;
      const padY = Math.ceil((newH - sm.height) / 2) + 2;

      const padded = await sharp(scaled)
        .extend({ top: padY, bottom: padY, left: padX, right: padX, background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png().toBuffer();
      const rotated = await sharp(padded)
        .rotate(rot, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png().toBuffer();
      helmetBuf = await sharp(rotated).trim({ threshold: 1 }).png().toBuffer();
      sm = await sharp(helmetBuf).metadata();
      log(`旋转 ${rot}° 后（留白 ±${padX}/±${padY}，已重新收紧）: ${sm.width}x${sm.height}`);
    } else {
      log(`头盔缩放后: ${sm.width}x${sm.height}`);
    }

    if (sm.width > pm.width || sm.height > pm.height) {
      throw new Error(`头盔 ${sm.width}x${sm.height} 比人物图 ${pm.width}x${pm.height} 还大，无法合成`);
    }

    // 半透明头盔（透出底下的头发和脸）
    if (opacity < 1) {
      const raw = await sharp(helmetBuf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const d = raw.data;
      for (let i = 3; i < d.length; i += 4) d[i] = Math.round(d[i] * opacity);
      helmetBuf = await sharp(d, {
        raw: { width: raw.info.width, height: raw.info.height, channels: 4 },
      }).png().toBuffer();
    }

    const left = Math.round(cx - sm.width / 2);
    const topY = Math.round(top);
    log(`落点: left=${left}, top=${topY}  (右下角 ${left + sm.width}, ${topY + sm.height})`);

    base = await sharp(PORTRAIT)
      .composite([{ input: helmetBuf, left, top: topY, blend: 'over' }])
      .webp({ quality: 92, alphaQuality: 100 })
      .toBuffer();
  }

  // ---- 统一输出（两种模式产出同一套文件，页面无需区分）----
  await sharp(base).toFile(`${out}.webp`);

  await sharp(base)
    .resize({ height: 1000, fit: 'inside' })
    .png({ compressionLevel: 9, palette: true, quality: 88, effort: 8 })
    .toFile(`${out}.png`);

  // 窄屏专用小图（移动端按 2~3 倍 DPR 算，900px 高足够）
  await sharp(base)
    .resize({ height: 900, fit: 'inside' })
    .webp({ quality: 90, alphaQuality: 100 })
    .toFile(`${out}-900.webp`);

  const st = await sharp(`${out}.webp`).metadata();
  log(`\n✓ ${out}.webp  ${st.width}x${st.height}  ${(statSync(`${out}.webp`).size / 1024).toFixed(1)} KB`);
  log(`✓ ${out}.png   ${(statSync(`${out}.png`).size / 1024).toFixed(1)} KB`);

  return { width: st.width, height: st.height };
}

// ---- 命令行入口 --------------------------------------------------------
const isCli = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isCli) {
  const arg = (k, d) => {
    const hit = process.argv.slice(2).find(a => a.startsWith(`--${k}=`));
    return hit ? Number(hit.split('=')[1]) : d;
  };
  await composeHelmet({
    helmet: !process.argv.includes('--no-helmet'),
    h: arg('h', 780),
    cx: arg('cx', 570),
    top: arg('top', 58),
    rot: arg('rot', 0),
    opacity: arg('opacity', 1),
  });

  // 预览：合成到首屏的深色底上
  const pm = await sharp(PORTRAIT).metadata();
  const preview = await sharp({
    create: { width: pm.width, height: pm.height, channels: 4, background: { r: 17, g: 17, b: 18, alpha: 1 } },
  }).composite([{ input: await sharp('assets/img/hero-composite.webp').toBuffer() }]).png().toBuffer();
  await sharp(preview).resize({ height: 620 }).png().toFile('tools/shots/compose-preview.png');
  console.log('预览: tools/shots/compose-preview.png');
}
