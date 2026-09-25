/**
 * build-symbol-font.mjs — 生成星座符号的字体子集
 *
 * 为什么需要：
 *   ♑（U+2651）这个字符同时存在「文字」和「emoji」两种呈现。
 *   电脑上走 Segoe UI Symbol，是单色的线条符号；
 *   安卓上却常常落到彩色 emoji 字体，渲染成紫底的图案 —— 两端对不上。
 *
 *   光加变体选择符 VS15（U+FE0E）不够保险：
 *   如果系统里压根没有收录该字形的单色字体，浏览器还是会退回 emoji。
 *   把字形自己托管，才能保证所有设备一致。
 *
 *   一个小文件（约 2KB）装下 12 星座，以后换星座也不用重新生成。
 *
 * 用法: node tools/build-symbol-font.mjs
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { statSync } from 'node:fs';

// U+2648 ~ U+2653：白羊到双鱼
const ZODIAC = '♈♉♊♋♌♍♎♏♐♑♒♓';

const OUT_DIR = 'assets/fonts';
const OUT = `${OUT_DIR}/zodiac-symbols.woff2`;

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
           '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const api = 'https://fonts.googleapis.com/css2' +
  `?family=Noto+Sans+Symbols&text=${encodeURIComponent(ZODIAC)}&display=swap`;
// 注意用 Noto Sans Symbols（第一代），不要用 Noto Sans Symbols 2 ——
// 后者的 kit 下载地址实测返回 HTTP 400，是 Google 那边的问题，不是我们请求写错了。

console.log(`\n星座字符: ${ZODIAC}`);
console.log('向 Google Fonts 请求子集...');

const cssRes = await fetch(api, { headers: { 'User-Agent': UA } });
if (!cssRes.ok) {
  console.error(`✗ 请求失败: HTTP ${cssRes.status}`);
  process.exit(1);
}
const css = await cssRes.text();

const m = /url\((https:\/\/[^)]+)\)/.exec(css);
if (!m) {
  console.error('✗ 返回的 CSS 里没有字体地址');
  console.error(css.slice(0, 400));
  process.exit(1);
}

console.log('下载字体文件...');
const fontRes = await fetch(m[1], { headers: { 'User-Agent': UA } });
if (!fontRes.ok) {
  console.error(`✗ 下载失败: HTTP ${fontRes.status}`);
  process.exit(1);
}
const buf = Buffer.from(await fontRes.arrayBuffer());

// woff2 魔数校验，防止下回来一个 HTML 错误页
if (buf.length < 4 || buf.toString('ascii', 0, 4) !== 'wOF2') {
  console.error(`✗ 下载到的不是 woff2（前 4 字节: ${buf.toString('ascii', 0, 4)}）`);
  process.exit(1);
}

await mkdir(OUT_DIR, { recursive: true });
await writeFile(OUT, buf);

console.log(`\n✓ ${OUT}  ${(statSync(OUT).size / 1024).toFixed(1)} KB`);
console.log('  已加进 --f-display / .stat__num--sym 的字栈\n');
