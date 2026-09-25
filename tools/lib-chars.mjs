/**
 * lib-chars.mjs — 字符提取的单一实现
 *
 * extract-chars.mjs（生成字符表）和 check-font-coverage.mjs（校验字符表）必须用
 * 同一套规则，否则两边对「哪些字算数」的理解会漂移：
 * 生成时剥了注释、校验时没剥，校验就会报出一堆注释里的假缺字；
 * 反过来更糟 —— 校验比生成宽松时，真缺字会被放过。
 * 所以规则只写一份，两边都从这里引。
 */

export const FILES = ['index.html', '404.html', 'assets/js/main.js'];

/** 参与排版、需要打进中文字体子集的码位区间 */
export function isCJK(ch) {
  const p = ch.codePointAt(0);
  return (p >= 0x4e00 && p <= 0x9fff)      // 基本汉字
      || (p >= 0x3400 && p <= 0x4dbf)      // 扩展 A
      || (p >= 0xf900 && p <= 0xfaff)      // 兼容汉字
      || (p >= 0x3000 && p <= 0x303f)      // 中日韩标点
      || (p >= 0xff00 && p <= 0xffef);     // 全角字符
}

/** 排版高频、但码位不在 CJK 区间的标点 */
export const EXTRA = '·—–…“”‘’「」《》';

/**
 * 剥掉注释。
 *
 * 注释不参与排版，里面的字不该进子集：随手写一句中文注释，就会把正文根本用不到的
 * 字塞进字体文件，还会让覆盖检查报出假缺口。
 *
 * 行注释的正则要求 `//` 前面不是冒号，免得把 `https://` 后半截当注释吃掉。
 */
export function stripComments(src, isJS) {
  let out = src.replace(/<!--[\s\S]*?-->/g, '');
  out = out.replace(/\/\*[\s\S]*?\*\//g, '');
  if (isJS) out = out.replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  return out;
}

/** 把一段文本里所有需要子集覆盖的字符收进 set */
export function collect(text, bag) {
  for (const ch of text || '') {
    if (isCJK(ch) || EXTRA.includes(ch)) bag.add(ch);
  }
  return bag;
}
