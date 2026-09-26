/**
 * 证明 build.mjs 里的 JS 语法检查真的会拦住语法错误
 * （检查必须能被证明会失败，否则等于没有）
 *
 * 背景：脚本里一个语法错误会让整个 IIFE 一行都不执行 ——
 * 页面照常显示、控制台也不一定有明显提示，只是所有交互静静地全都没了。
 * 这个脚本把那种损坏注入回去，确认构建确实会停下来。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const FILE = 'assets/js/main.js';
const orig = readFileSync(FILE, 'utf8');

function runBuild() {
  try {
    const out = execFileSync('node', ['tools/build.mjs'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? 1, out: (e.stdout || '') + (e.stderr || '') };
  }
}

// 1) 正常情况：应当通过
const good = runBuild();
console.log(`正常脚本：退出码 ${good.code}  ${good.code === 0 ? '✓ 通过' : '✗ 不该失败'}`);

/* 2) 注入真实的语法错误。
      不是随便塞个乱字符，而是复现这次真正踩到的那一类：
      同一作用域里重复声明同名变量。它比"少个括号"更阴险 ——
      文件看起来完全正常，只是运行时不执行。 */
const bad = orig.replace(
  "    const mouse = { x: 0, y: 0, has: false };",
  "    const mouse = { x: 0, y: 0, has: false };\n    let mouse = 1;   // 重复声明\n");
if (bad === orig) {
  console.log('  ✗ 没能注入（锚点没找到），这次自检不成立');
  process.exit(1);
}
writeFileSync(FILE, bad, 'utf8');
const r = runBuild();
writeFileSync(FILE, orig, 'utf8');

const caught = r.code !== 0 && /语法错误/.test(r.out);
console.log(`注入重复声明后：退出码 ${r.code}  ${caught ? '✓ 被拦住了' : '✗ 没拦住'}`);
const detail = (r.out.match(/SyntaxError[^\n]*/) || [])[0];
if (detail) console.log(`  报出了原因：${detail.trim()}`);

// 3) 还原后应当恢复通过
const again = runBuild();
console.log(`还原后：退出码 ${again.code}  ${again.code === 0 ? '✓ 恢复' : '✗ 仍然失败'}`);
const restored = readFileSync(FILE, 'utf8') === orig;
console.log(`文件内容逐字节还原：${restored ? '✓' : '✗ 源文件被改坏了！'}`);

process.exit(caught && good.code === 0 && again.code === 0 && restored ? 0 : 1);
