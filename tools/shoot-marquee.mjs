/**
 * shoot-marquee.mjs — 把跑马灯整个循环抓成一条胶片，肉眼确认不露白
 *
 * 露白是"大部分时候正常、只在循环某一段出现"的问题，
 * 随手截一张大概率截不到。这里把动画暂停在循环的若干时刻各截一条，
 * 纵向拼成一张图 —— 每一格都盖满才算真的无缝。
 *
 * 用法: node tools/shoot-marquee.mjs
 */
import puppeteer from 'puppeteer-core';
import sharp from 'sharp';
import { existsSync } from 'node:fs';

const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find(p => existsSync(p));

const VIEWPORTS = [
  { name: 'marquee-loop', width: 1440, label: '1440' },
  { name: 'marquee-loop-wide', width: 2560, label: '2560' },
];

const browser = await puppeteer.launch({
  executablePath: EDGE, headless: 'new', args: ['--disable-gpu', '--hide-scrollbars'],
});

for (const vp of VIEWPORTS) {
  const page = await browser.newPage();
  await page.setViewport({ width: vp.width, height: 900 });
  await page.goto('http://127.0.0.1:4321/', { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 2400));

  const box = await page.evaluate(() => {
    const el = document.querySelector('.marquee');
    const r = el.getBoundingClientRect();
    return { x: 0, y: Math.round(r.top + scrollY), width: Math.round(r.width), height: Math.round(r.height) };
  });

  const FRAMES = 6;
  const shots = [];
  for (let i = 0; i < FRAMES; i++) {
    const f = i / FRAMES;
    await page.evaluate(({ f }) => {
      const track = document.querySelector('.marquee__track');
      const dur = parseFloat(getComputedStyle(track).animationDuration);
      track.style.animationPlayState = 'paused';
      track.style.animationDelay = `${(-f * dur).toFixed(2)}s`;
      void track.offsetWidth;
    }, { f });
    await new Promise(r => setTimeout(r, 260));
    shots.push(await page.screenshot({ clip: box, captureBeyondViewport: true }));
    // 记录这一格右侧还差多少
    const gap = await page.evaluate(() => {
      const tr = document.querySelector('.marquee__track').getBoundingClientRect();
      const br = document.querySelector('.marquee').getBoundingClientRect();
      return Math.round(Math.max(br.right - tr.right, 0));
    });
    console.log(`  ${vp.label}px  第 ${i + 1}/${FRAMES} 格（循环 ${(f * 100).toFixed(0)}%）  右侧露白 ${gap}px`);
  }

  // 纵向拼起来
  const metas = await Promise.all(shots.map(b => sharp(b).metadata()));
  const W = Math.max(...metas.map(m => m.width));
  const GAP = 6;
  const H = metas.reduce((s, m) => s + m.height, 0) + GAP * (shots.length - 1);
  await sharp({ create: { width: W, height: H, channels: 3, background: '#d2ff00' } })
    .composite(shots.map((b, i) => ({
      input: b,
      left: 0,
      top: metas.slice(0, i).reduce((s, m) => s + m.height, 0) + GAP * i,
    })))
    .png()
    .toFile(`tools/shots/${vp.name}.png`);
  console.log(`✓ tools/shots/${vp.name}.png  ${W}x${H}`);
  await page.close();
}

await browser.close();
