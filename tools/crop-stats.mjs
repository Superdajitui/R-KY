/**
 * crop-stats.mjs — 把「档案」四格单独截出来，方便肉眼核对
 *
 * 量出来的数字能说明对齐，但"符号在手机上跟电脑是不是同一个字形"
 * 这种事最终还是得看一眼。这里把桌面和手机各截一张，输出到 tools/shots/。
 *
 * 用法: node tools/crop-stats.mjs [url]
 */
import puppeteer from 'puppeteer-core';
import sharp from 'sharp';
import { existsSync } from 'node:fs';

const URL_BASE = process.argv[2] || 'http://127.0.0.1:4321/';
const DSF = 2;

const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find(p => existsSync(p));

const browser = await puppeteer.launch({
  executablePath: EDGE, headless: 'new', args: ['--disable-gpu', '--hide-scrollbars'],
});

const JOBS = [
  { name: 'stats-desktop', width: 1440, height: 900 },
  { name: 'stats-tablet', width: 821, height: 1180 },
  { name: 'stats-mobile', width: 390, height: 844 },
];

for (const job of JOBS) {
  const page = await browser.newPage();
  await page.setViewport({ width: job.width, height: job.height, deviceScaleFactor: DSF });
  await page.goto(URL_BASE, { waitUntil: 'networkidle0', timeout: 60000 });
  await new Promise(r => setTimeout(r, 2000));
  await page.evaluate(() => document.querySelector('#stats').scrollIntoView({ block: 'center', behavior: 'instant' }));
  await new Promise(r => setTimeout(r, 1800));

  const box = await page.evaluate(() => {
    const row = document.querySelector('.stats__row');
    const r = row.getBoundingClientRect();
    return {
      x: Math.max(0, Math.round(r.left + window.scrollX)),
      y: Math.max(0, Math.round(r.top + window.scrollY)),
      width: Math.round(r.width),
      height: Math.round(r.height),
    };
  });

  const buf = await page.screenshot({ clip: box, captureBeyondViewport: true });
  // 顺手报告这一格里符号实际用的是哪个字体
  const symFont = await page.evaluate(() => {
    const el = document.querySelector('.stat__num--sym');
    return el ? getComputedStyle(el).fontFamily.split(',')[0].replace(/["']/g, '') : '(无)';
  });

  const out = `tools/shots/${job.name}.png`;
  await sharp(buf).toFile(out);
  console.log(`✓ ${out}   ${box.width}x${box.height}  符号字体: ${symFont}`);
  await page.close();
}

await browser.close();
