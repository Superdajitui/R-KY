/**
 * extract-chars.mjs — 提取站点里实际用到的所有字符
 *
 * 用来给中文字体做子集化：站点一共也就用了几百个汉字，
 * 没必要让用户下载几 MB 的完整字库。
 *
 * 用法: node tools/extract-chars.mjs
 */
import { readFile, writeFile } from 'node:fs/promises';

const FILES = ['index.html', '404.html', 'assets/js/main.js'];

let all = '';
for (const f of FILES) {
  try {
    all += await readFile(f, 'utf8');
  } catch { console.warn(`  跳过（不存在）: ${f}`); }
}

// 只保留会真正参与排版的字符：
//   中文（含扩展区）、日文假名、全角标点、以及常用拉丁与数字
const chars = new Set();
for (const ch of all) {
  const c = ch.codePointAt(0);
  const isCJK = (c >= 0x4e00 && c <= 0x9fff)      // 基本汉字
             || (c >= 0x3400 && c <= 0x4dbf)      // 扩展 A
             || (c >= 0xf900 && c <= 0xfaff)      // 兼容汉字
             || (c >= 0x3000 && c <= 0x303f)      // 中日韩标点
             || (c >= 0xff00 && c <= 0xffef);     // 全角字符
  if (isCJK) chars.add(ch);
}

// 中文排版里高频、但码位不在 CJK 区间的标点。
// 不一起打进子集的话，它们会回退到别的字体，字形和字重都会跟正文对不上。
for (const ch of '·—–…“”‘’「」《》') chars.add(ch);

const sorted = [...chars].sort((a, b) => a.codePointAt(0) - b.codePointAt(0));
const text = sorted.join('');

await writeFile('tools/charset.txt', text, 'utf8');

console.log(`\n扫描文件: ${FILES.join(', ')}`);
console.log(`源文件总字符: ${all.length}`);
console.log(`去重后的 CJK 字符: ${sorted.length} 个`);
console.log(`子集文本长度: ${text.length}\n`);
console.log('字符列表:');
console.log('  ' + text);
