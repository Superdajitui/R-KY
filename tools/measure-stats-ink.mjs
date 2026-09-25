/**
 * measure-stats-ink.mjs — 量「档案」四格大字【真实墨迹】的对齐情况
 *
 * 为什么不用 Range.getBoundingClientRect()：
 *   它返回的是行盒（line box）的并集，不是字的实际墨迹。
 *   .stat__num 里还有 .01 这样的子元素，行盒会被撑得比字高得多，
 *   量出来"字高 120px"其实只是行高——拿这个判断对齐是错的。
 *
 * 这里改成最实在的办法：截图像素。把每格大字所在的区域裁出来，
 * 数哪些像素是亮的，得到真正的墨迹上下沿和视觉重心。
 *
 * 两个量测上的坑（都踩过，写在这里免得下次再踩）：
 *   1. 裁剪窗口的基准必须是【没被 transform 的元素】（用 .stat 格子），
 *      用大字自己的 getBoundingClientRect() 会因为它是含 transform 的，
 *      窗口跟着字一起动，光学修正量永远量不出来。
 *   2. 窗口上方要留余量：字形可能溢出盒子上沿，
 *      贴着盒子顶裁会切出假的"墨迹顶 0.0px"。
 *
 * 用法: node tools/measure-stats-ink.mjs [url]
 */
import puppeteer from 'puppeteer-core';
import sharp from 'sharp';
import { existsSync } from 'node:fs';

const URL_BASE = process.argv[2] || 'http://127.0.0.1:4321/';
const DSF = 2; // 放大截，边界更准
const PAD_TOP = 28;

const VIEWPORTS = [
  { name: '桌面 1440x900', width: 1440, height: 900 },
  { name: '平板 1024x768', width: 1024, height: 768 },
  { name: '平板 821x1180', width: 821, height: 1180 },
  { name: '手机 390x844', width: 390, height: 844 },
];

const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find(p => existsSync(p));

const browser = await puppeteer.launch({
  executablePath: EDGE, headless: 'new', args: ['--disable-gpu', '--hide-scrollbars'],
});

const w = (s, n) => String(s).padEnd(n);
const r = (s, n) => String(s).padStart(n);
const spread = (a) => Math.max(...a) - Math.min(...a);

let worstBaseline = 0;
let worst = null;

for (const vp of VIEWPORTS) {
  const page = await browser.newPage();
  await page.setViewport({ width: vp.width, height: vp.height, deviceScaleFactor: DSF });
  await page.goto(URL_BASE, { waitUntil: 'networkidle0', timeout: 40000 });
  await new Promise(r => setTimeout(r, 2000));
  await page.evaluate(() => document.querySelector('#stats').scrollIntoView({ block: 'start', behavior: 'instant' }));
  await new Promise(r => setTimeout(r, 1800));

  const zones = await page.evaluate((PAD_TOP) => {
    return [...document.querySelectorAll('.stat')].map(cell => {
      const num = cell.querySelector('.stat__num');
      const key = cell.querySelector('.stat__key');
      const cr = cell.getBoundingClientRect();
      const kr = key.getBoundingClientRect();
      return {
        text: num.textContent.trim(),
        x: Math.max(0, Math.round(cr.left + window.scrollX)),
        y: Math.max(0, Math.round(cr.top + window.scrollY)),
        w: Math.round(num.getBoundingClientRect().width),
        h: Math.max(8, Math.round(kr.top - cr.top - 4)),
      };
    });
  }, PAD_TOP);

  const results = [];
  for (const z of zones) {
    const buf = await page.screenshot({
      clip: { x: z.x, y: z.y, width: z.w, height: z.h },
      captureBeyondViewport: true,
    });
    const { data, info } = await sharp(buf).greyscale().raw().toBuffer({ resolveWithObject: true });

    // 背景纯黑（#111112 → 灰度约 17），字是白的或霓虹绿。
    // 阈值 60：远高于背景，又低到能抓住描边的抗锯齿边。
    const TH = 60;
    let top = Infinity, bot = -1, left = Infinity, right = -1;
    const rowHits = new Array(info.height).fill(0);
    for (let y = 0; y < info.height; y++) {
      for (let x = 0; x < info.width; x++) {
        if (data[y * info.width + x] > TH) {
          if (y < top) top = y;
          if (y > bot) bot = y;
          if (x < left) left = x;
          if (x > right) right = x;
          rowHits[y]++;
        }
      }
    }
    if (bot < 0) { results.push({ text: z.text, empty: true }); continue; }

    let wsum = 0, ysum = 0;
    rowHits.forEach((n, y) => { wsum += n; ysum += n * y; });

    results.push({
      text: z.text,
      top: top / DSF, bot: bot / DSF, h: (bot - top + 1) / DSF,
      inkW: (right - left + 1) / DSF,
      centroid: wsum ? (ysum / wsum) / DSF : NaN,
    });
  }

  console.log(`\n════ ${vp.name} ════\n`);
  console.log('  ' + w('内容', 10) + r('墨迹顶', 9) + r('墨迹底', 9) + r('墨迹高', 9) + r('墨迹宽', 9) + r('视觉重心', 10));
  for (const x of results) {
    if (x.empty) { console.log('  ' + w(x.text, 10) + '  量不到墨迹'); continue; }
    console.log('  ' + w(x.text, 10) + r(x.top.toFixed(1), 9) + r(x.bot.toFixed(1), 9)
      + r(x.h.toFixed(1), 9) + r(x.inkW.toFixed(1), 9) + r(x.centroid.toFixed(1), 10));
  }

  const filled = results.filter(x => !x.empty);
  const bots = filled.map(x => x.bot);
  const baselineSpread = spread(bots);
  const heights = filled.map(x => x.h);

  const sym = filled.find(x => /[\u2648-\u2653]/.test(x.text));
  const others = filled.filter(x => x !== sym);
  const avgOtherH = others.reduce((s, x) => s + x.h, 0) / others.length;
  const ratio = sym ? sym.h / avgOtherH : NaN;
  const symLow = sym ? sym.bot - Math.min(...others.map(x => x.bot)) : NaN;

  console.log('');
  console.log(`  墨迹底（基线）差值: ${baselineSpread.toFixed(1)}px   ${baselineSpread <= 1.5 ? '✓ 四格共线' : '✗ 不齐'}`);
  console.log(`  墨迹高:             最矮 ${Math.min(...heights).toFixed(1)} / 最高 ${Math.max(...heights).toFixed(1)}px`
    + `（年号本来就要最大，属于层级）`);
  if (sym) {
    console.log(`  符号 ♑ 视觉大小比:   ${ratio.toFixed(2)}   ${ratio >= 0.88 && ratio <= 1.12 ? '✓ 与邻居相当' : '✗ 偏大/偏小'}`);
  }
  console.log(`  四格都单行:         ${zones.every(z => z.h > 0) ? '✓' : '✗'}`);

  if (baselineSpread > worstBaseline) { worstBaseline = baselineSpread; worst = vp.name; }

  await page.close();
}

await browser.close();

console.log('\n' + '─'.repeat(56));
if (worstBaseline <= 1.5) {
  console.log(`✓ 全部通过：四种视口下四格墨迹底都共线（最差 ${worstBaseline.toFixed(1)}px @ ${worst}）`);
  console.log('─'.repeat(56) + '\n');
} else {
  console.log(`✗ 未通过：最差 ${worstBaseline.toFixed(1)}px @ ${worst}`);
  console.log('─'.repeat(56) + '\n');
  process.exit(1);
}
