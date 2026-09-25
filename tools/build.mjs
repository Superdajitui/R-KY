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

for (const file of ['index.html', '404.html']) {
  const p = path.join(DIST, file);
  if (!existsSync(p)) continue;
  let html = await readFile(p, 'utf8');
  const before = html;
  html = html
    .replace(/(content=")assets\/img\/og\.jpg(")/g, `$1${BASE}/assets/img/og.jpg$2`)
    .replace('</head>', `<link rel="canonical" href="${BASE}/">\n`
      + `<meta property="og:url" content="${BASE}/">\n</head>`);

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
