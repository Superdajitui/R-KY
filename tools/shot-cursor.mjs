/* 一次性：把光标停在一个密度高的位置上，拍下来看"拨开"到什么程度。
   用法: node tools/shot-cursor.mjs [url] */
import puppeteer from 'puppeteer-core';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const URL_ = process.argv[2] || 'http://127.0.0.1:4321/';
const OUT = path.resolve('tools/shots');
const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find(p => fs.existsSync(p));
const sleep = ms => new Promise(r => setTimeout(r, ms));

const b = await puppeteer.launch({ executablePath: EDGE, headless: 'new', args: ['--no-sandbox', '--hide-scrollbars'] });
const p = await b.newPage();
await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
await p.goto(URL_, { waitUntil: 'networkidle0' });
await sleep(2600);

for (const [name, x, y] of [['cursor-left', 380, 330], ['cursor-mid', 760, 470], ['cursor-right', 1050, 300]]) {
  await p.mouse.move(20, 880);
  await sleep(500);
  await p.mouse.move(x, y);
  await sleep(900);
  await p.screenshot({ path: path.join(OUT, `shards2-${name}.png`) });
  console.log(`${name} -> ${x},${y}`);
}
console.log('状态:', JSON.stringify(await p.evaluate(() => window.__shards())));
await b.close();
