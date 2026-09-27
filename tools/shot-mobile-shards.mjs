/* 一次性：拍一张手机上的欢迎页（看箔片在小屏上的密度和构图） */
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';

const URL_ = process.argv[2] || 'http://127.0.0.1:4321/';
const OUT = path.resolve('tools/shots');
fs.mkdirSync(OUT, { recursive: true });

const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find(p => fs.existsSync(p));

const b = await puppeteer.launch({
  executablePath: EDGE,
  headless: 'new',
  args: ['--no-sandbox', '--force-device-scale-factor=2', '--hide-scrollbars'],
});

const p = await b.newPage();
await p.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await p.goto(URL_, { waitUntil: 'networkidle0', timeout: 30000 });
await new Promise(r => setTimeout(r, 2600));

await p.screenshot({ path: path.join(OUT, 'shards-mobile.png') });
console.log('手机欢迎页 ->', path.join(OUT, 'shards-mobile.png'));
console.log(JSON.stringify(await p.evaluate(() => window.__shards && window.__shards())));

await b.close();
