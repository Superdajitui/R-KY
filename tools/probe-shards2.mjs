/* 箔片引擎的体检：帧耗时、帧间隔、配色、以及几张实拍。
   用法: node tools/probe-shards2.mjs [url] */
import puppeteer from 'puppeteer-core';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const URL_ = process.argv[2] || 'http://127.0.0.1:4321/';
const OUT = path.resolve('tools/shots');
fs.mkdirSync(OUT, { recursive: true });
const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find(p => fs.existsSync(p));
const sleep = ms => new Promise(r => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: EDGE, headless: 'new',
  args: ['--no-sandbox', '--hide-scrollbars'],
});

async function run(name, vp, shot) {
  const page = await browser.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await page.setViewport(vp);
  await page.goto(URL_, { waitUntil: 'networkidle0', timeout: 30000 });
  await sleep(2500);

  const st = await page.evaluate(() => window.__shards && window.__shards());
  const iv = await page.evaluate(() => new Promise(res => {
    const ts = []; let last = 0;
    const tick = t => {
      if (last) ts.push(t - last);
      last = t;
      if (ts.length < 120) requestAnimationFrame(tick);
      else { ts.sort((a, b) => a - b); res({ avg: +(ts.reduce((a, v) => a + v, 0) / ts.length).toFixed(1), p95: +ts[Math.floor(ts.length * .95)].toFixed(1) }); }
    };
    requestAnimationFrame(tick);
  }));

  console.log(`\n════ ${name} ${vp.width}×${vp.height} ════`);
  console.log('  ', JSON.stringify(st));
  console.log(`   帧间隔 平均 ${iv.avg}ms  p95 ${iv.p95}ms`);

  if (shot) {
    const buf = await page.screenshot({ path: path.join(OUT, shot) });
    const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
    let lit = 0, total = 0, maxG = 0, hs = 0, hn = 0;
    for (let i = 0; i < data.length; i += info.channels) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      total++;
      if (g > maxG) maxG = g;
      if (g > 90 && g > r + 20) {
        lit++;
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
        if (d) hs += (60 * ((b - r) / d + 2) + 360) % 360, hn++;
      }
    }
    console.log(`   发光像素 ${(lit / total * 100).toFixed(2)}%  最亮绿 ${maxG}  平均色相 ${hn ? (hs / hn).toFixed(0) : 0}°`);
    console.log(`   出图 tools/shots/${shot}`);
  }
  if (errs.length) console.log('   ✗ 控制台:', errs.slice(0, 3));
  await page.close();
}

/* 桌面也按 dsf=2 量：真实笔记本的还原度屏就是 2 倍像素，
   而 Canvas 的填充开销是跟【像素】走的 —— 按 dsf=1 量出来的余量是假的。 */
await run('桌面', { width: 1440, height: 900, deviceScaleFactor: 2 }, 'shards2-desktop.png');
await run('手机', { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, 'shards2-mobile.png');

await browser.close();
