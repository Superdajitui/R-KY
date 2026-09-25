/**
 * shoot-section.mjs — 完整截取某个区块（桌面 + 手机），用来看排版
 *
 * 为什么不能用普通截图：滚动动效是【可逆】的 —— 滚回区块顶部后，
 * 下半部分又回到透明；而 captureBeyondViewport 拍的正是折叠线以下的区域。
 * 所以这里先把进度全部推到 1 再拍，否则永远拍到一片黑。
 * （懒加载的图也要先滚一遍才会加载。）
 *
 * 用法:
 *   node tools/shoot-section.mjs passions
 *   node tools/shoot-section.mjs about contact
 *   node tools/shoot-section.mjs passions https://superdajitui.github.io/R-KY/   # 截线上
 */
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';

const argv = process.argv.slice(2).filter(a => !a.startsWith('-'));
const URL_BASE = argv.find(a => a.startsWith('http')) || 'http://127.0.0.1:4321/';
const SECTIONS = argv.filter(a => !a.startsWith('http'));
const LIST = SECTIONS.length ? SECTIONS : ['passions'];
const IS_LIVE = URL_BASE.includes('github.io');

const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find(p => existsSync(p));

const VIEWPORTS = [
  { suffix: 'desktop', width: 1440, height: 1000, dsf: 1 },
  { suffix: 'mobile', width: 390, height: 844, dsf: 2 },
];

const browser = await puppeteer.launch({
  executablePath: EDGE, headless: 'new', args: ['--disable-gpu', '--hide-scrollbars'],
});

for (const id of LIST) {
  for (const vp of VIEWPORTS) {
    const page = await browser.newPage();
    await page.setViewport({ width: vp.width, height: vp.height, deviceScaleFactor: vp.dsf });
    await page.goto(URL_BASE, { waitUntil: 'networkidle0', timeout: 60000 });
    await new Promise(r => setTimeout(r, 2600));

    const exists = await page.evaluate(s => !!document.querySelector(s), `#${id}`);
    if (!exists) { console.log(`✗ 找不到 #${id}`); await page.close(); continue; }

    // 先滚过整个区块：让懒加载的图加载、让滚动动效走一遍
    await page.evaluate(async (s) => {
      const el = document.querySelector(s);
      const bottom = el.getBoundingClientRect().top + scrollY + el.offsetHeight;
      for (let y = Math.max(0, el.getBoundingClientRect().top + scrollY - innerHeight * 0.6);
           y < bottom + innerHeight * 0.4; y += innerHeight * 0.45) {
        window.scrollTo(0, y);
        await new Promise(r => setTimeout(r, 300));
      }
    }, `#${id}`);
    await page.waitForFunction(
      s => [...document.querySelectorAll(`${s} img`)].every(i => i.complete && i.naturalWidth > 0),
      { timeout: 15000 }, `#${id}`).catch(() => console.log(`  ⚠ #${id} 有图片未加载完`));

    // 再回到区块顶部，并强制显示终态。
    //
    // 这里必须用 .scrub-off（应用自己的降级类，CSS 里带 !important），
    // 不能直接写 --p:1：引擎的 rAF 循环会在下一帧按真实滚动位置重算并覆盖掉，
    // 折叠线以下的行就又变回透明了 —— 第一版就是这么写的，只拍到第一行。
    await page.evaluate((s) => {
      document.querySelector(s).scrollIntoView({ block: 'start', behavior: 'instant' });
      document.documentElement.classList.add('scrub-off');
    }, `#${id}`);
    await new Promise(r => setTimeout(r, 800));

    const box = await page.evaluate((s) => {
      const r = document.querySelector(s).getBoundingClientRect();
      return { x: 0, y: Math.round(r.top + scrollY), width: Math.round(r.width), height: Math.round(r.height) };
    }, `#${id}`);

    const out = `tools/shots/sec-${id}-${vp.suffix}${IS_LIVE ? '-live' : ''}.png`;
    await page.screenshot({ path: out, clip: box, captureBeyondViewport: true });
    console.log(`✓ ${out}  ${box.width}x${box.height}`);
    await page.close();
  }
}

await browser.close();
