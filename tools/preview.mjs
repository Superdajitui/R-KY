import sharp from 'sharp';

// 把抠好的图合成到深色底上，顺便检查发丝边缘有没有白边/缺口
const IN = 'assets/img/portrait.webp';
const meta = await sharp(IN).metadata();
const W = 900;
const H = Math.round((meta.height / meta.width) * W);

const portrait = await sharp(IN).resize({ width: W, fit: 'inside' }).toBuffer();

// 深色背景 + 一道霓虹绿光晕，模拟首屏实际观感
const bgSvg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${W}" height="${H}" fill="#111112"/>
  <circle cx="${W / 2}" cy="${H * 0.34}" r="${W * 0.34}" fill="#d2ff00" opacity="0.16"/>
</svg>`;

await sharp(Buffer.from(bgSvg))
  .composite([{ input: portrait, gravity: 'south' }])
  .png()
  .toFile('tools/preview-dark.png');

// 再来一张浅灰底，专门看白色残留
const bgSvg2 = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${W}" height="${H}" fill="#8a8a8a"/>
</svg>`;
await sharp(Buffer.from(bgSvg2))
  .composite([{ input: portrait, gravity: 'south' }])
  .png()
  .toFile('tools/preview-gray.png');

console.log('预览已生成: tools/preview-dark.png / tools/preview-gray.png');
