import { chromium } from '../../node_modules/.pnpm/playwright@1.63.0/node_modules/playwright/index.mjs';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto('file:///Users/arkoroy/Desktop/tyr/pitch-deck-20261010.html', {
  waitUntil: 'networkidle',
});
await page.evaluate(() => document.fonts.ready);
await page.addStyleTag({
  content: `@page {size:1600px 900px;margin:0} @media print {html,body{width:1600px;margin:0;padding:0}.deck{width:1600px;height:auto}.slide{width:1600px;height:900px;min-height:900px;break-inside:avoid;break-after:page;transition:none}.slide:last-child{break-after:auto;page-break-after:auto}.a{animation:none!important;opacity:1!important;transform:none!important}}`,
});
await page.emulateMedia({ media: 'print' });
console.log(
  await page.evaluate(() => ({
    slides: document.querySelectorAll('.slide').length,
    fonts: [...document.fonts].map((f) => ({ family: f.family, status: f.status })),
    images: [...document.images].map((i) => ({ loaded: i.complete && i.naturalWidth > 0 })),
    overflow: [...document.querySelectorAll('.slide')].map((s, i) => ({
      slide: i + 1,
      overflow: s.scrollHeight > s.clientHeight,
    })),
  })),
);
await page.pdf({
  path: 'output/pdf/pitch-deck-20261010.pdf',
  printBackground: true,
  preferCSSPageSize: true,
  displayHeaderFooter: false,
});
await browser.close();
