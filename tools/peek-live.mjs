/**
 * peek-live.mjs — 打开线上站点，把首屏人物区域截出来
 * 用法: node tools/peek-live.mjs [url]
 */
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';

const URL_BASE = process.argv[2] || 'https://superdajitui.github.io/R-KY/';
const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find(p => existsSync(p));

const sleep = ms => new Promise(r => setTimeout(r, ms));

// 分别用「启用 WebGL」和「禁用 WebGL」两种配置打开，对比结果
const CONFIGS = [
  ['webgl-on',  ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader']],
  ['webgl-off', ['--disable-gpu', '--disable-webgl', '--disable-webgl2']],
];

for (const [label, extra] of CONFIGS) {
  const browser = await puppeteer.launch({
    executablePath: EDGE, headless: 'new',
    args: ['--hide-scrollbars', ...extra],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });

  await page.goto(URL_BASE, { waitUntil: 'networkidle0', timeout: 60000 });
  await sleep(3200);

  const st = await page.evaluate(() => {
    const c = document.querySelector('.hero__portrait');
    const cv = document.querySelector('.hero__canvas');
    const img = document.querySelector('.hero__img');
    const pic = document.querySelector('.hero__portrait picture');
    const r = c.getBoundingClientRect();
    return {
      webgl: c.classList.contains('is-webgl'),
      canvasBox: cv ? `${cv.getBoundingClientRect().width.toFixed(0)}x${cv.getBoundingClientRect().height.toFixed(0)}` : '无',
      canvasDisplay: cv ? getComputedStyle(cv).display : '无',
      pictureDisplay: pic ? getComputedStyle(pic).display : '无',
      imgLoaded: !!img?.complete && img.naturalWidth > 0,
      imgNatural: img ? `${img.naturalWidth}x${img.naturalHeight}` : '无',
      imgSrc: (img?.currentSrc || '').split('/').pop(),
      box: `${r.width.toFixed(0)}x${r.height.toFixed(0)}`,
      boxTop: Math.round(r.top),
    };
  });

  const clip = {
    x: Math.round(1440 / 2 - 260), y: Math.max(0, st.boxTop),
    width: 520, height: Math.min(640, 900 - st.boxTop),
  };
  await page.screenshot({ path: `tools/shots/peek-${label}.png`, clip });

  // 量一下这块区域的平均亮度：全黑就说明什么都没画出来
  const buf = await page.screenshot({ clip });
  let sum = 0, n = 0;
  for (let i = 0; i < buf.length; i += 997) { sum += buf[i]; n++; }

  console.log(`\n════ ${label} ════`);
  console.log(`  is-webgl=${st.webgl}  canvas=${st.canvasBox} display=${st.canvasDisplay}`);
  console.log(`  picture display=${st.pictureDisplay}`);
  console.log(`  图片已加载=${st.imgLoaded}  原始=${st.imgNatural}  src=${st.imgSrc}`);
  console.log(`  容器 ${st.box}  top=${st.boxTop}`);
  console.log(`  区域采样均值(粗略)=${(sum / n).toFixed(0)}`);
  if (errs.length) { console.log('  报错:'); [...new Set(errs)].slice(0, 5).forEach(e => console.log(`    ${e}`)); }
  else console.log('  无报错');

  await browser.close();
}
console.log('\n截图: tools/shots/peek-webgl-on.png / peek-webgl-off.png');
