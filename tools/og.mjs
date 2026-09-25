/**
 * og.mjs — 生成社交分享预览图 assets/img/og.jpg (1200x630)
 * 微信 / QQ / Twitter 分享链接时显示的那张卡片。
 */
import sharp from 'sharp';

const W = 1200, H = 630;

// 用系统字体渲染文字：librsvg 走 fontconfig，
// 嵌入外部 @font-face 不可靠，系统字体反而稳。
const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="glow" cx="72%" cy="46%" r="52%">
      <stop offset="0%"   stop-color="#d2ff00" stop-opacity="0.34"/>
      <stop offset="55%"  stop-color="#d2ff00" stop-opacity="0.08"/>
      <stop offset="100%" stop-color="#d2ff00" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%"   stop-color="#111112" stop-opacity="0"/>
      <stop offset="100%" stop-color="#111112" stop-opacity="1"/>
    </linearGradient>
  </defs>

  <rect width="${W}" height="${H}" fill="#111112"/>
  <rect width="${W}" height="${H}" fill="url(#glow)"/>

  <!-- 左侧竖条装饰 -->
  <rect x="0" y="0" width="6" height="${H}" fill="#d2ff00"/>

  <!-- 文案 -->
  <g font-family="Microsoft YaHei, PingFang SC, sans-serif">
    <text x="72" y="196" font-size="26" letter-spacing="7"
          fill="#d2ff00" font-weight="700">学生 · 开发者 · 创作者</text>

    <text x="66" y="336" font-size="132" font-weight="900"
          fill="#f4f4f1" letter-spacing="2">任恺昱</text>

    <text x="72" y="424" font-size="62" font-weight="700"
          fill="#8a8d92" letter-spacing="14">KERRY R</text>

    <text x="72" y="512" font-size="30" fill="#c6c9cd">
      安静的人，<tspan fill="#d2ff00" font-weight="700">做扎实的事</tspan>。
    </text>

    <text x="72" y="576" font-size="21" fill="#5c5f64" letter-spacing="3">
      STUDENT / DEVELOPER / CREATOR
    </text>
  </g>

  <!-- 底部渐隐，压住人物下缘 -->
  <rect x="0" y="${H - 150}" width="${W}" height="150" fill="url(#fade)"/>
</svg>`;

// 人物抠像放到右侧。注意合成图不能超出画布，否则 sharp 直接报错，
// 所以先把高度卡死在画布高度内，再按原始比例算宽度。
//
// 路径是 src/ 不是 assets/img/：抠好的原图属于构建素材，不随站点发布，
// 早就挪到 src/ 了。这里一直没跟着改，于是 og.jpg 再也生成不出来，
// 线上那张分享图一直是旧的（改了标语也不会变）—— 这种"工具坏了但没人发现"
// 的问题最隐蔽，因为产物文件还在，看起来一切正常。
const PORTRAIT_H = H;
const portrait = await sharp('src/portrait-1400.webp')
  .resize({ height: PORTRAIT_H, fit: 'inside' })
  .toBuffer();
const pm = await sharp(portrait).metadata();

const left = W - pm.width;          // 右对齐
const top = H - pm.height;          // 底对齐，让烤进图片的底部渐隐正好落在画布下缘

console.log(`人物贴图 ${pm.width}x${pm.height}，放到 (${left}, ${top})`);

await sharp(Buffer.from(svg))
  .composite([{ input: portrait, left, top }])
  .jpeg({ quality: 88, mozjpeg: true })
  .toFile('assets/img/og.jpg');

const st = await sharp('assets/img/og.jpg').metadata();
console.log(`已生成 assets/img/og.jpg  ${st.width}x${st.height}`);
