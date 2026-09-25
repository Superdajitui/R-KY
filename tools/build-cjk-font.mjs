/**
 * build-cjk-font.mjs — 生成中文字体子集
 *
 * 为什么需要：
 *   中文用字栈原本是 'Inter','Microsoft YaHei','PingFang SC',system-ui ——
 *   Windows 命中微软雅黑、iPhone 命中苹方、安卓回退到思源黑体，
 *   三个平台字形不同，同一个「镂空描边」效果在手机上就和电脑上不一样。
 *   把中文字体也自托管，才能保证所有设备渲染一致。
 *
 * 为什么是子集：
 *   完整思源黑体好几 MB，而本站一共只用了五百多个汉字。
 *   只打包用到的字，体积能压到几十 KB。
 *
 * 数据来源：Google Fonts 的 text= 参数，直接返回只含指定字符的
 * 可变字体（一个字重文件覆盖 100~900）。Noto Sans SC 是 SIL OFL 授权，
 * 可以自由自托管。
 *
 * 用法: node tools/build-cjk-font.mjs
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { statSync } from 'node:fs';

const CHARSET = 'tools/charset.txt';
const OUT_DIR = 'assets/fonts';
const OUT = `${OUT_DIR}/noto-sans-sc-subset.woff2`;

// Google Fonts 会按 User-Agent 决定返回哪种格式，必须给一个现代浏览器 UA
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
           '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const text = (await readFile(CHARSET, 'utf8')).trim();
if (!text) {
  console.error(`✗ ${CHARSET} 是空的，请先运行 node tools/extract-chars.mjs`);
  process.exit(1);
}
console.log(`\n字符集: ${text.length} 个字符`);

// 去重（charset.txt 本身已经是去重的，这里再兜一层）
const uniq = [...new Set(text)].join('');
if (uniq.length !== text.length) {
  console.log(`  去重后: ${uniq.length} 个`);
  await writeFile(CHARSET, uniq, 'utf8');
}

const api = 'https://fonts.googleapis.com/css2' +
  `?family=Noto+Sans+SC:wght@400..900&text=${encodeURIComponent(uniq)}&display=swap`;

console.log('\n向 Google Fonts 请求子集...');
const cssRes = await fetch(api, { headers: { 'User-Agent': UA } });
if (!cssRes.ok) {
  console.error(`✗ 请求失败: HTTP ${cssRes.status}`);
  process.exit(1);
}
const css = await cssRes.text();

// 从 CSS 里取出字体地址
const m = /url\((https:\/\/[^)]+)\)/.exec(css);
if (!m) {
  console.error('✗ 返回的 CSS 里没有字体地址');
  console.error(css.slice(0, 400));
  process.exit(1);
}
const fontUrl = m[1];

// 顺带把 font-weight 范围打出来，确认拿到的是可变字体
const wght = /font-weight:\s*([^;]+);/.exec(css);
console.log(`  字重范围: ${wght ? wght[1].trim() : '（未标注）'}`);

console.log('下载字体文件...');
const fontRes = await fetch(fontUrl, { headers: { 'User-Agent': UA } });
if (!fontRes.ok) {
  console.error(`✗ 下载失败: HTTP ${fontRes.status}`);
  process.exit(1);
}
const buf = Buffer.from(await fontRes.arrayBuffer());

// woff2 的魔数校验，防止下回来一个 HTML 错误页
if (buf.length < 4 || buf.toString('ascii', 0, 4) !== 'wOF2') {
  console.error(`✗ 下载到的不是 woff2（前 4 字节: ${buf.toString('ascii', 0, 4)}）`);
  process.exit(1);
}

await mkdir(OUT_DIR, { recursive: true });
await writeFile(OUT, buf);

const kb = statSync(OUT).size / 1024;
console.log(`\n✓ ${OUT}  ${kb.toFixed(1)} KB`);
console.log(`  相比完整思源黑体（约 5000 KB）省了 ${(5000 / kb).toFixed(0)} 倍\n`);
console.log('下一步: 在 assets/css/style.css 里加上 @font-face，');
console.log('       并把 \'Noto Sans SC\' 放进 --f-cn 字栈。\n');
