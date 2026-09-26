/**
 * build.mjs — 打生产包到 docs/
 *
 * 输出目录叫 docs/ 是刻意的：GitHub Pages 可以直接把仓库里的某个文件夹
 * 作为站点根目录，用 main 分支的 /docs 是最省事的做法 ——
 * 不用额外分支，也不用把开发工具一起推上去。
 *
 * 只复制运行时真正需要的文件，把开发工具、node_modules、截图全部排除。
 * 另外生成 .nojekyll、sitemap.xml，并校验产物里没有绝对路径
 * （GitHub Pages 的项目站点跑在 /仓库名/ 子路径下，绝对路径会 404）。
 *
 * 用法:
 *   node tools/build.mjs                              # 用下面的正式域名
 *   node tools/build.mjs https://u.github.io/R-KY     # 临时换成别的地址
 */
import { mkdir, rm, cp, writeFile, readFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = path.join(ROOT, 'docs');

// 站点的正式地址。必须是真实可访问的域名：
// canonical、og:image、sitemap.xml、robots.txt 都会写进这个值。
//
// 这里曾经默认成占位域名 https://example.github.io/R-KY，
// 结果打包时忘了传参数，线上就跑着 example.github.io ——
// 分享链接抓不到预览图、canonical 又把搜索引擎指向一个不存在的地址。
// 所以默认值改成正式域名，并且下面加了硬拦截：占位域名一律拒绝打包。
const SITE = 'https://superdajitui.github.io/R-KY';
const PLACEHOLDER = /example\.(com|github\.io)|localhost|127\.0\.0\.1/i;

const BASE = (process.argv[2] || SITE).replace(/\/+$/, '');

if (PLACEHOLDER.test(BASE)) {
  console.error(`\n✗ 拒绝打包：站点地址是占位/本地地址 —— ${BASE}`);
  console.error('  canonical、og:image、sitemap 都会写成这个值，发出去就是坏的。');
  console.error(`  正式域名应为: ${SITE}`);
  console.error('  确实要用占位地址请显式传参，不要靠默认值。\n');
  process.exit(1);
}

// 运行时需要的资源
const INCLUDE = [
  'index.html',
  '404.html',
  'assets/css',
  'assets/js',
  'assets/img',
  'assets/fonts',
];

console.log(`\n打包目标: ${DIST}`);
console.log(`站点地址: ${BASE}\n`);

await rm(DIST, { recursive: true, force: true });
await mkdir(DIST, { recursive: true });

let files = 0, bytes = 0;

async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(DIST, full);
    if (entry.isDirectory()) await walk(full);
    else {
      const st = await stat(full);
      files++; bytes += st.size;
      console.log(`  ${rel}  (${(st.size / 1024).toFixed(1)} KB)`);
    }
  }
}

for (const item of INCLUDE) {
  const src = path.join(ROOT, item);
  if (!existsSync(src)) { console.warn(`  ⚠ 缺少 ${item}，已跳过`); continue; }
  await cp(src, path.join(DIST, item), { recursive: true });
}

// .nojekyll —— 阻止 GitHub Pages 走 Jekyll 处理
await writeFile(path.join(DIST, '.nojekyll'), '');

// ---- 补全绝对地址 + 给 404 页注入 <base> ----
// 微信、Twitter 这类抓取器对相对地址支持很差，og:image 必须给绝对 URL。
//
// 404.html 额外需要 <base>：它会被 GitHub Pages 在任意子路径下返回
// （例如 /R-KY/no-such-page/），此时相对路径 assets/css/style.css 会被
// 解析成 /R-KY/no-such-page/assets/... 直接 404，整页样式全丢。
// 注入站点根路径后就都指向正确位置了。
const urlPath = new URL(BASE).pathname.replace(/\/?$/, '/');

// ---- CSS / JS 加内容指纹 ----
//
// 为什么必须做：GitHub Pages 给静态资源的缓存是 max-age=600，
// 手机浏览器还会更激进地复用。结果是"我改了、也部署了，用户却还看到旧的"——
// 这次就真实发生过：窄屏顺序已经改成文字在上，用户手机上仍是旧的，
// 只能靠手动清缓存才能看到。加个 ?v=<内容哈希>，内容一变 URL 就变，
// 浏览器自然拿新的，不用再教用户"强制刷新"。
async function hashOf(rel) {
  const p = path.join(DIST, rel);
  if (!existsSync(p)) return null;
  const buf = await readFile(p);
  return createHash('sha1').update(buf).digest('hex').slice(0, 8);
}

const CSS_V = await hashOf('assets/css/style.css');
const JS_V = await hashOf('assets/js/main.js');
// 算不出指纹就说明产物缺文件 —— 这时如果只是"跳过替换"，
// 页面会引用无指纹的旧地址，用户又看到旧样式，而且构建还是绿的。
// 这种静默降级正是缓存问题复发的方式，所以直接报错。
if (!CSS_V || !JS_V) {
  console.error(`\n✗ 无法为静态资源生成指纹（style.css=${CSS_V} main.js=${JS_V}）`);
  console.error('  产物里缺少 CSS 或 JS，构建结果不可信。\n');
  process.exit(1);
}
console.log(`  指纹: style.css?v=${CSS_V}  main.js?v=${JS_V}`);

/* ---------- CSS 括号配平检查 ----------
   这一条是被真实事故逼出来的：我在媒体查询里加了一段规则，
   多写了一个 }，于是 @media (max-width:820px) 提前闭合 ——
   后面四条手机端规则漏到了桌面（技能列表、档案列表、页脚排版全变），
   而那个多余的 } 又让**它之后的所有块失效**，
   包括 @supports (height:100svh) 里覆盖 --hero-portrait-h 的那段。

   表现是什么？手机上人物变高、把背后的 KERRY 挡住了 ——
   用户看到的是"文字怎么变小了"，跟括号八竿子打不着。
   CSS 没有编译期，写错了不报错，只是静静地失效。
   所以放在打包这一步兜底：不平衡就不许发布。 */
const cssText = await readFile(path.join(DIST, 'assets/css/style.css'), 'utf8');
// 剥注释时把注释换成等量的换行，这样字符下标和行号仍然对得上原文件 ——
// 否则报出来的行号是"剥完注释之后"的行号，指不到真正出问题的地方，
// 那种误导性的报错比不报还费时间。
const cssNoComment = cssText.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
let depth = 0;
let badAt = -1;
for (let i = 0; i < cssNoComment.length; i++) {
  if (cssNoComment[i] === '{') depth++;
  else if (cssNoComment[i] === '}') { depth--; if (depth < 0 && badAt < 0) badAt = i; }
}
if (depth !== 0 || badAt >= 0) {
  const at = badAt >= 0 ? badAt : cssNoComment.length;
  const lineNo = cssNoComment.slice(0, at).split('\n').length;
  console.error(`\n✗ CSS 括号不配平（结束时深度 ${depth}${badAt >= 0 ? `，第 ${lineNo} 行处深度变负` : ''}）`);
  if (badAt >= 0) console.error(`  ${cssText.split('\n')[lineNo - 1]?.trim().slice(0, 70)}`);
  console.error('  多写或少写一个 } 会让后面所有规则静默失效，必须修掉再发布。\n');
  process.exit(1);
}
console.log(`  CSS 括号配平 ✓`);

/* ---------- JS 语法检查 ----------
   和上面那条括号检查是同一类问题：脚本里一个语法错误会让【整个 IIFE】
   一行都不执行 —— 页面照常显示、控制台也不一定有明显提示，
   只是所有交互静静地全都没了。

   这次真踩到了：在同一个作用域里重复声明了一个 running
   （上面 const running = el => ...，下面 let running = false），
   SyntaxError 直接把整份脚本废掉，表现是"欢迎页一圈波纹都没有"。
   构建当时是绿的，因为括号守卫只看 CSS。

   用 node --check 而不是自己写解析：这是运行时自己的判断，最权威。 */
try {
  execFileSync(process.execPath, ['--check', path.join(DIST, 'assets/js/main.js')],
    { stdio: ['ignore', 'pipe', 'pipe'] });
  console.log('  JS 语法 ✓');
} catch (e) {
  const msg = String((e.stderr || e.stdout || '')).trim().split('\n').slice(0, 6).join('\n  ');
  console.error('\n✗ assets/js/main.js 语法错误 —— 整份脚本都不会执行，所有交互会静静地失效');
  console.error('  ' + msg + '\n');
  process.exit(1);
}

/* ---------- 源文件乱码检查 ----------
   这一条同样是被真实事故逼出来的，而且就发生在这次改动里：
   用 PowerShell 的 Set-Content 改一个源文件，中文被按 GBK 解码后又存成 UTF-8，
   整份文件静默变成乱码 —— 105 个汉字没了，"弹簧"成了"寮圭哀"，
   全程没有任何报错。文件能打开、构建能过、页面能显示，
   只是每一句中文都烂掉了，得等用户看见才发现。
   （那次是漏掉了一个 else 分支，靠人顺手查了一下才逮住。）

   只挑几个"现代中文里几乎不可能单独出现"的字当指纹：
   UTF-8 被当成 GBK 时，中文标点和常用字几乎必然退化成这几个。
   不做整段启发式判断，是为了避免误报 ——
   误报会拦住正常发布，比漏报还烦人。 */
const MOJIBAKE = /[\u9225\u951b\u9286\u93b4\u9229]/;
let garbled = null;
for (const f of ['index.html', '404.html', 'assets/css/style.css', 'assets/js/main.js']) {
  const p = path.join(DIST, f);
  if (!existsSync(p)) continue;
  const t = await readFile(p, 'utf8');
  const m = t.match(MOJIBAKE);
  if (m) {
    const lineNo = t.slice(0, m.index).split('\n').length;
    garbled = { f, lineNo, ch: m[0], sample: (t.split('\n')[lineNo - 1] || '').trim().slice(0, 70) };
    break;
  }
}
if (garbled) {
  console.error(`\n✗ ${garbled.f} 第 ${garbled.lineNo} 行出现乱码字符「${garbled.ch}」`);
  console.error(`  ${garbled.sample}`);
  console.error('  多半是编辑中文源文件时被按 GBK 重新编码了。');
  console.error('  改源文件请用编辑器，不要用 PowerShell 的 Set-Content / -replace。\n');
  process.exit(1);
}
console.log(`  源文件无乱码 ✓`);

for (const file of ['index.html', '404.html']) {
  const p = path.join(DIST, file);
  if (!existsSync(p)) continue;
  let html = await readFile(p, 'utf8');
  const before = html;
  html = html
    .replace(/(content=")assets\/img\/og\.jpg(")/g, `$1${BASE}/assets/img/og.jpg$2`)
    .replace('</head>', `<link rel="canonical" href="${BASE}/">\n`
      + `<meta property="og:url" content="${BASE}/">\n</head>`);

  if (CSS_V) html = html.replaceAll('assets/css/style.css', `assets/css/style.css?v=${CSS_V}`);
  if (JS_V) html = html.replaceAll('assets/js/main.js', `assets/js/main.js?v=${JS_V}`);

  if (file === '404.html') {
    html = html.replace('<!--BUILD:BASE-->', `<base href="${urlPath}">`);
  }

  if (html !== before) {
    await writeFile(p, html);
    console.log(`  已处理: ${file}${file === '404.html' ? `  (<base href="${urlPath}">)` : ''}`);
  }
}

// robots.txt
await writeFile(path.join(DIST, 'robots.txt'),
  `User-agent: *\nAllow: /\n\nSitemap: ${BASE}/sitemap.xml\n`);

// sitemap.xml
await writeFile(path.join(DIST, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n` +
  `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
  `  <url>\n    <loc>${BASE}/</loc>\n    <changefreq>monthly</changefreq>\n    <priority>1.0</priority>\n  </url>\n` +
  `</urlset>\n`);

console.log('');
await walk(DIST);
console.log(`\n共 ${files} 个文件，${(bytes / 1024).toFixed(1)} KB`);

// ---- 校验：产物里不能出现指向根目录的绝对路径 ----
// 项目站点跑在 /仓库名/ 下，/assets/... 这种写法一定会 404
console.log('\n检查绝对路径...');
let bad = 0;
async function scan(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { await scan(full); continue; }
    if (!/\.(html|css|js)$/.test(entry.name)) continue;
    const text = await readFile(full, 'utf8');
    // 匹配 src="/  href="/ 但排除：
    //   // 开头的协议相对地址
    //   <base href="/..."> —— 那是我们故意注入的站点根，不是资源引用
    const cleaned = text.replace(/<base\s[^>]*>/gi, '');
    const hits = [...cleaned.matchAll(/(?:src|href)\s*=\s*["']\/(?!\/)[^"']*/g)];
    if (hits.length) {
      bad += hits.length;
      console.log(`  ✗ ${path.relative(DIST, full)}:`);
      hits.slice(0, 5).forEach(h => console.log(`      ${h[0]}`));
    }
  }
}
await scan(DIST);
if (bad === 0) console.log('  ✓ 未发现指向根目录的绝对路径，可安全部署到子路径');
else console.log(`  ✗ 发现 ${bad} 处绝对路径，部署到子路径会 404，必须改成相对路径`);

console.log(`\n生产包已就绪: ${DIST}`);
console.log('下一步: 双击根目录的 deploy-github.bat 一键发布到 GitHub Pages\n');
