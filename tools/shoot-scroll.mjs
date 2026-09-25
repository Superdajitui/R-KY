/**
 * shoot-scroll.mjs — 把滚动动效的关键帧截下来，肉眼核对
 *
 * 检查脚本只能证明"内容没被藏住、进度到位"，证明不了"好不好看"。
 * 这个脚本按滚动进度抓几帧，看动效的中途状态是否自然。
 *
 * 用法: node tools/shoot-scroll.mjs [url]
 */
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';

const URL_BASE = process.argv[2] || 'http://127.0.0.1:4321/';
const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find(p => existsSync(p));

const browser = await puppeteer.launch({
  executablePath: EDGE, headless: 'new', args: ['--disable-gpu', '--hide-scrollbars'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.goto(URL_BASE, { waitUntil: 'networkidle0', timeout: 60000 });
await new Promise(r => setTimeout(r, 2600));

const vh = 900;

// 每帧：先滚到位，等阻尼收敛，再截图
const SHOTS = [
  { name: 'scroll-1-hero-recede',  desc: '首屏退场中途', y: () => vh * 1.22 },
  { name: 'scroll-2-about-sticky', desc: '关于：左栏钉住 / 段落点亮', y: (p) => p.aboutTop + vh * 0.35 },
  { name: 'scroll-3-passions',     desc: '热爱：三栏错落进入', y: (p) => p.passionTop - vh * 0.45 },
  { name: 'scroll-4-cards',        desc: '项目：卡片错落', y: (p) => p.cardTop - vh * 0.32 },
  { name: 'scroll-5-skills',       desc: '技能：标题推上来', y: (p) => p.skillTop - vh * 0.62 },
  { name: 'scroll-6-contact',      desc: '联系：光晕涨起 + 标题推上来', y: (p) => p.contactTop - vh * 0.30 },
];

const pos = await page.evaluate(() => {
  const top = (sel) => {
    const el = document.querySelector(sel);
    let y = 0;
    for (let n = el; n; n = n.offsetParent) y += n.offsetTop;
    return y;
  };
  return {
    aboutTop: top('.about'),
    passionTop: top('.passions'),
    cardTop: top('.cards'),
    skillTop: top('.skills__list'),
    contactTop: top('.contact'),
  };
});

for (const s of SHOTS) {
  await page.evaluate(y => window.scrollTo(0, Math.round(y)), s.y(pos));
  await new Promise(r => setTimeout(r, 1100));   // 让阻尼彻底收敛
  await page.screenshot({ path: `tools/shots/${s.name}.png` });
  console.log(`✓ tools/shots/${s.name}.png   ${s.desc}`);
}

await browser.close();
