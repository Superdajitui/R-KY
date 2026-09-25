/**
 * shoot-copy.mjs — 把几个候选标题按网站真实样式渲染成一张对比图
 *
 * 为什么要有这个：文案是要人拍板的，光用文字描述"这句读起来更凝练"
 * 没有意义 —— 大标题的字号、断行、霓虹色位置都会影响观感。
 * 这里用页面真实的 CSS 和自托管字体渲一遍，所见即所得。
 *
 * 用法:
 *   node tools/shoot-copy.mjs            # 用下面的 CANDIDATES
 *   node tools/shoot-copy.mjs 1 3        # 只渲第 1、3 条
 *
 * 文案写法：用 | 分行，用 *星号* 标记要变霓虹绿的部分。
 */
import puppeteer from 'puppeteer-core';
import { writeFile, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';

// 第二行定为「一束光*等到刚好*。」（一+量+名 / 动+到 / 副+形）。
// 第一行必须和它【对仗 + 押韵】—— 韵脚要落在 ao 辙上（好 hǎo）。
// 所以第一行结尾只能用：巧 qiǎo / 少 shǎo / 小 xiǎo / 老 lǎo / 早 zǎo 这一类，
// 而且不能再出现「刚好」（上一版就栽在重复上）。
const CANDIDATES = [
  { tag: 'A', text: '一行代码写到最少|一束光*等到刚好*。', note: '对仗：一行代码 / 一束光，写到 / 等到，最少 / 刚好。押韵：shǎo–hǎo（同为三声）。也呼应「多余的东西是噪音」' },
  { tag: 'B', text: '一条线走到最巧|一束光*等到刚好*。', note: '对仗最严：3/2/2 对 3/2/2。押韵：qiǎo–hǎo。赛车走线' },
  { tag: 'C', text: '一首歌循环到老|一束光*等到刚好*。', note: '押韵：lǎo–hǎo。把孙燕姿那条也带进来，最有人味' },
  { tag: 'D', text: '一个弯过得不早|一束光*等到刚好*。', note: '押韵：zǎo–hǎo。晚刹车是赛车里的真本事，不是形容词堆砌' },
  { tag: 'E', text: '一个问题拆到最小|一束光*等到刚好*。', note: '押韵：xiǎo–hǎo。最像 ISTJ：拆解到不能再拆' },
];

const pick = process.argv.slice(2).map(Number).filter(n => n >= 1 && n <= CANDIDATES.length);
const list = pick.length ? pick.map(n => CANDIDATES[n - 1]) : CANDIDATES;

const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find(p => existsSync(p));

const html = (items) => `<!DOCTYPE html>
<html lang="zh-CN" class="js"><head><meta charset="UTF-8">
<title>标题候选</title>
<link rel="stylesheet" href="assets/css/style.css">
<style>
  body{background:var(--ink);margin:0;padding:clamp(1.5rem,4vw,3rem)}
  .sheet{display:flex;flex-direction:column;gap:clamp(1.6rem,3.4vw,2.6rem)}
  .item{border-top:1px solid var(--ink-3);padding-top:1.1rem}
  .tag{font:600 .72rem/1.6 var(--f-body);letter-spacing:.22em;color:var(--neon);text-transform:uppercase}
  .note{font:.78rem/1.7 var(--f-body);color:var(--mute);margin:.15rem 0 .9rem}
  /* 别在这里自己写栅格：必须直接用页面真实的 .wrap.about__wrap / .about__left，
     否则媒体查询不生效 —— 第一版自己写了个两列栅格，
     结果 390px 下也按两列渲染，窄到每行只剩几个字，
     看起来像是文案折行很难看，其实是预览本身失真。 */
  .about__left .sec__title{margin-bottom:0}
</style></head><body>
<div class="sheet">
${items.map(it => `  <div class="item">
    <p class="tag">${it.tag}</p>
    <p class="note">${it.note}</p>
    <div class="wrap about__wrap"><div class="about__left">
      <h2 class="sec__title">${it.text
        .split('|')
        .map(line => line.replace(/\*(.+?)\*/g, '<em>$1</em>'))
        .join('<br>')}</h2>
    </div><div></div></div>
  </div>`).join('\n')}
</div>
</body></html>`;

const FILE = 'copy-preview.html';
await writeFile(FILE, html(list), 'utf8');

const browser = await puppeteer.launch({
  executablePath: EDGE, headless: 'new', args: ['--disable-gpu', '--hide-scrollbars'],
});
const page = await browser.newPage();
// 两种宽度都截：宽屏看断行，窄屏看手机上的观感
for (const [name, w] of [['copy-options', 1440], ['copy-options-mobile', 390]]) {
  await page.setViewport({ width: w, height: 900, deviceScaleFactor: w < 500 ? 2 : 1 });
  await page.goto(`http://127.0.0.1:4321/${FILE}`, { waitUntil: 'networkidle0', timeout: 40000 });
  await page.evaluate(() => document.fonts.ready);
  await new Promise(r => setTimeout(r, 700));
  const box = await page.evaluate(() => {
    const r = document.querySelector('.sheet').getBoundingClientRect();
    return { x: 0, y: 0, width: Math.ceil(r.width + 48), height: Math.ceil(r.height + 48) };
  });
  const out = `tools/shots/${name}.png`;
  await page.screenshot({ path: out, clip: box, captureBeyondViewport: true });
  console.log(`✓ ${out}  (${w}px)`);
}
await browser.close();
await unlink(FILE);
