/**
 * check-font-coverage.mjs — 页面上的汉字是否都被中文字体子集覆盖
 *
 * 为什么需要：
 *   中文字体是【子集】的，只打包了站点实际用到的字。
 *   一旦改了文案却忘了重建子集，新出现的汉字会静默回退到系统字体 ——
 *   页面不报错、不缺字，只是那几个字的字形和旁边对不上，
 *   往往要等用户截图指出才发现。
 *
 * 为什么不用 document.fonts.check()：
 *   试过，不成立。它只判断「字体加载了没」，**不检查字形是否存在** ——
 *   拿一个子集里绝对没有的生僻字去试，它照样返回 true。
 *   一个永远通过的检查比没有检查更危险，所以改成纯 Node 比对字符表。
 *
 * 原理：
 *   tools/charset.txt 是生成子集时的输入，等价于「字体里有哪些字」。
 *   把页面当前的汉字和它逐字比对，就能发现「改了文案但没重建字体」。
 *
 * 用法: node tools/check-font-coverage.mjs
 */
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const FILES = ['index.html', '404.html', 'assets/js/main.js'];
const CHARSET = 'tools/charset.txt';
const FONT = 'assets/fonts/noto-sans-sc-subset.woff2';

if (!existsSync(CHARSET) || !existsSync(FONT)) {
  console.error('✗ 找不到字符表或字体文件，请先运行: npm run font:chars && npm run font:build');
  process.exit(2);
}

const isCJK = (c) => {
  const p = c.codePointAt(0);
  return (p >= 0x4e00 && p <= 0x9fff)      // 基本汉字
      || (p >= 0x3400 && p <= 0x4dbf)      // 扩展 A
      || (p >= 0xf900 && p <= 0xfaff)      // 兼容汉字
      || (p >= 0x3000 && p <= 0x303f)      // 中日韩标点
      || (p >= 0xff00 && p <= 0xffef);     // 全角字符
};
// 排版高频但码位不在 CJK 区间的标点，extract-chars 也会打进子集
const EXTRA = '·—–…“”‘’「」《》';

let pageText = '';
for (const f of FILES) {
  if (!existsSync(f)) continue;
  pageText += await readFile(f, 'utf8');
}
const pageChars = new Set([...pageText].filter(isCJK));
for (const c of EXTRA) if (pageText.includes(c)) pageChars.add(c);

const charset = await readFile(CHARSET, 'utf8');
const fontChars = new Set([...charset]);

const missing = [...pageChars].filter(c => !fontChars.has(c));
const unused = [...fontChars].filter(c => !pageChars.has(c));

console.log('\n中文字体子集覆盖检查');
console.log(`  字符表: ${CHARSET}  (${fontChars.size} 字)`);
console.log(`  字体:   ${FONT}`);
console.log(`  页面当前用到: ${pageChars.size} 个 CJK 字符`);

// 自检：确认字符表这个「数据集」本身是合理的。
// 它既不能是空的（那样每个字都会被误报成缺失），
// 也不能包罗万象（那样什么都发现不了）。
// 注意不要把「探测字出现在页面上」当成失败 —— 那恰恰是这条检查要抓的情形。
const PROBE = '龘';
const charsetSane = fontChars.size > 300
  && fontChars.has('任')        // 页面里肯定有的常用字
  && !fontChars.has(PROBE);     // 几乎不可能出现在子集里的生僻字
if (!charsetSane) {
  console.log(`\n  ✗ 自检未通过：字符表看起来不合理（${fontChars.size} 字）`);
  console.log('    可能是文件损坏或读错了，比对结果不可信');
  process.exit(2);
}

if (missing.length === 0) {
  console.log('  ✓ 页面上的汉字全部在子集内');
  if (unused.length) {
    console.log(`  （子集里有 ${unused.length} 个字当前没用到，无害，只是略占体积）`);
  }
  process.exit(0);
}

console.log(`\n  ✗ 有 ${missing.length} 个字不在子集里，会回退到系统字体：`);
console.log(`    ${missing.join('')}`);
console.log('\n  修复: npm run font:chars && npm run font:build');
process.exit(1);
