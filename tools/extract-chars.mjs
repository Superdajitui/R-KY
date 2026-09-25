/**
 * extract-chars.mjs — 提取站点里实际用到的所有字符
 *
 * 用来给中文字体做子集化：站点一共也就用了几百个汉字，
 * 没必要让用户下载几 MB 的完整字库。
 *
 * 用法: node tools/extract-chars.mjs
 */
import { readFile, writeFile } from 'node:fs/promises';
import { FILES, EXTRA, collect, stripComments } from './lib-chars.mjs';

let all = '';
for (const f of FILES) {
  try {
    all += stripComments(await readFile(f, 'utf8'), f.endsWith('.js'));
  } catch { console.warn(`  跳过（不存在）: ${f}`); }
}

const chars = collect(all, new Set());
for (const ch of EXTRA) chars.add(ch);

const sorted = [...chars].sort((a, b) => a.codePointAt(0) - b.codePointAt(0));
const text = sorted.join('');

await writeFile('tools/charset.txt', text, 'utf8');

console.log(`\n扫描文件: ${FILES.join(', ')}`);
console.log(`源文件总字符（已剥注释）: ${all.length}`);
console.log(`去重后的 CJK 字符: ${sorted.length} 个`);
console.log(`子集文本长度: ${text.length}\n`);
console.log('字符列表:');
console.log('  ' + text);
