/**
 * shoot-copy.mjs — 把候选文案按网站真实样式渲染成对比图
 *
 * 为什么要有这个：文案是要人拍板的，光用文字描述"这句读起来更凝练"
 * 没有意义 —— 字号、断行、霓虹色的位置都会影响观感。
 * 这里用页面真实的 CSS 和自托管字体渲一遍，所见即所得。
 *
 * 用法:
 *   node tools/shoot-copy.mjs                 # 渲当前 SLOT 的全部候选
 *   node tools/shoot-copy.mjs title           # 指定 slot：title（板块大标题）/ tagline（首屏标语）
 *   node tools/shoot-copy.mjs tagline 1 3     # 只渲第 1、3 条
 *
 * 文案写法：用 | 分行，用 *星号* 标记要变霓虹绿的部分。
 *
 * ⚠ 预览必须复用页面真实的类名（.sec__title / .hero__tagline / .about__wrap …），
 *   不要自己另写一套排版。踩过：第一版给大标题自己写了个两列栅格，
 *   媒体查询不生效，390px 下也按两列渲，窄到每行只剩几个字，
 *   看起来像文案折行难看，其实是预览本身失真。
 */
import puppeteer from 'puppeteer-core';
import { writeFile, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const esc = (s) => s.replace(/\*(.+?)\*/g, '<em>$1</em>');

const SLOTS = {
  // 「关于」板块的大标题：受左栏宽度约束，长度要盯紧
  title: {
    file: 'copy-options',
    intro: '板块大标题「关于我」',
    candidates: [
      { tag: '当前线上', text: '一首歌循环到老|一束光*等到刚好*。', note: '已定稿，列在这里做对照' },
      { tag: '候选 A', text: '把日子过成台账|把喜欢*做成手艺*。', note: '对仗 + 押韵（账 zhàng / 艺 yì 不押，仅结构对仗）' },
    ].slice(0, 0),   // 大标题已定稿，暂时不渲
    body: (inner) => `<div class="wrap about__wrap"><div class="about__left">${inner}</div><div></div></div>`,
    render: (text) => `<h2 class="sec__title">${text}</h2>`,
  },

  // 首屏左下角那句标语：字号小、位置在底部，受底部一行宽度约束
  tagline: {
    file: 'tagline-options',
    intro: '首屏标语（hero 左下角那句）',
    candidates: [
      { tag: '候选 A', text: '话不多，*事做满*。', note: '内倾 + 做实；八个字，最像你' },
      { tag: '候选 B', text: '嘴上没词，*手上有活*。', note: '两截对仗；不会讲，但拿得出东西' },
      { tag: '候选 C', text: '安静的人，*做扎实的事*。', note: '把"安静"摆在前面，性格先于能力' },
      { tag: '候选 D', text: '不聪明，但*坐得住*。', note: '自嘲里带底气；坐得住是摩羯和 ISTJ 的底色' },
      { tag: '候选 E', text: '*认死理*，也认真。', note: '把 ISTJ 的"固执"摊开说，认得理也认得出' },
      { tag: '候选 F', text: '慢热，但*认准了就不换*。', note: '和「一首歌循环到老」同一个脾气' },
    ],
    body: (inner) => `<div class="hero__foot demo-foot">${inner}</div>`,
    render: (text) => `<p class="hero__tagline">${text}</p>`,
  },
};

const args = process.argv.slice(2);
const slotName = SLOTS[args[0]] ? args.shift() : 'tagline';
const slot = SLOTS[slotName];
const picks = args.map(Number).filter(n => n >= 1 && n <= slot.candidates.length);
const list = (picks.length ? picks.map(n => slot.candidates[n - 1]) : slot.candidates)
  .filter(c => c.text);

if (!list.length) {
  console.error(`slot「${slotName}」没有候选文案`);
  process.exit(1);
}

const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find(p => existsSync(p));

const html = (items) => `<!DOCTYPE html>
<html lang="zh-CN" class="js"><head><meta charset="UTF-8">
<title>文案候选</title>
<link rel="stylesheet" href="assets/css/style.css">
<style>
  body{background:var(--ink);margin:0;padding:clamp(1.5rem,4vw,3rem)}
  .sheet{display:flex;flex-direction:column;gap:clamp(1.4rem,3vw,2.2rem)}
  .item{border-top:1px solid var(--ink-3);padding-top:1.1rem}
  .tag{font:600 .72rem/1.6 var(--f-body);letter-spacing:.22em;color:var(--neon);text-transform:uppercase}
  .note{font:.78rem/1.7 var(--f-body);color:var(--mute);margin:.15rem 0 1rem}
  h2.sec__title{margin-bottom:0}
  /* 首屏标语本来是绝对定位在 hero 底部的，预览里改成静态流式，
     但保留 .hero__foot 这个类名，好让窄屏的居中媒体查询照样生效。
     opacity 必须用 !important 顶回来：页面里有一条
     「html.js .hero__foot{opacity:0}」（等 body.is-hero 才播入场动画），
     预览页永远不会有 is-hero，不顶回来的话所有候选文字都是隐形的 ——
     第一版就是这样，图上只剩标签，一条文案都看不见。 */
  .demo-foot{position:static;left:auto;right:auto;bottom:auto;padding:0;opacity:1!important}
</style></head><body>
<div class="sheet">
${items.map(it => `  <div class="item">
    <p class="tag">${it.tag}</p>
    <p class="note">${it.note}</p>
    ${slot.body(slot.render(esc(it.text).split('|').join('<br>')))}
  </div>`).join('\n')}
</div>
</body></html>`;

const FILE = 'copy-preview.html';
await writeFile(FILE, html(list), 'utf8');

const browser = await puppeteer.launch({
  executablePath: EDGE, headless: 'new', args: ['--disable-gpu', '--hide-scrollbars'],
});
const page = await browser.newPage();
for (const [suffix, w] of [['', 1440], ['-mobile', 390]]) {
  await page.setViewport({ width: w, height: 900, deviceScaleFactor: w < 500 ? 2 : 1 });
  await page.goto(`http://127.0.0.1:4321/${FILE}`, { waitUntil: 'networkidle0', timeout: 40000 });
  await page.evaluate(() => document.fonts.ready);
  await new Promise(r => setTimeout(r, 700));
  const box = await page.evaluate(() => {
    const r = document.querySelector('.sheet').getBoundingClientRect();
    return { x: 0, y: 0, width: Math.ceil(r.width + 48), height: Math.ceil(r.height + 48) };
  });
  const out = `tools/shots/${slot.file}${suffix}.png`;
  await page.screenshot({ path: out, clip: box, captureBeyondViewport: true });
  console.log(`✓ ${out}  (${w}px)`);
}
await browser.close();
await unlink(FILE);
