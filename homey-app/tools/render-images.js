'use strict';

/**
 * Renders the SVG icons in assets/ and drivers/<driver>/assets/ to the PNG sizes
 * Homey wants. Needs Playwright with its headless Chromium; in the Coder
 * workspace, run it with brew-log's install:
 *
 *   NODE_PATH=/home/coder/projects/home/brew-log/node_modules \
 *   LD_LIBRARY_PATH=~/.local/share/pw-libs/root/usr/lib/x86_64-linux-gnu:~/.local/share/pw-libs/root/lib/x86_64-linux-gnu \
 *   FONTCONFIG_FILE=~/.local/share/pw-libs/fontconfig/fonts.conf \
 *   node tools/render-images.js
 */

const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const APP = process.argv[2] || path.join(__dirname, '..');
const jobs = [];
const svgData = (file, color) => fs.readFileSync(file, 'utf8').replaceAll('stroke="#000"', `stroke="${color}"`).replaceAll('fill="#000"', `fill="${color}"`);

for (const [name, w, h] of [['small', 250, 175], ['large', 500, 350], ['xlarge', 1000, 700]]) {
  jobs.push({ out: path.join(APP, 'assets/images', `${name}.png`), w, h, bg: '#1F4E5F', svg: svgData(path.join(APP, 'assets/icon.svg'), '#FFFFFF'), scale: 0.8 });
}
for (const driver of ['futurehome-thermostat', 'futurehome-han-sensor']) {
  for (const [name, size] of [['small', 75], ['large', 500], ['xlarge', 1000]]) {
    jobs.push({ out: path.join(APP, 'drivers', driver, 'assets/images', `${name}.png`), w: size, h: size, bg: '#FFFFFF', svg: svgData(path.join(APP, 'drivers', driver, 'assets/icon.svg'), '#1F4E5F'), scale: 0.9 });
  }
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  for (const job of jobs) {
    await page.setViewportSize({ width: job.w, height: job.h });
    const side = Math.round(Math.min(job.w, job.h) * job.scale);
    await page.setContent(`<html><body style="margin:0;width:${job.w}px;height:${job.h}px;background:${job.bg};display:flex;align-items:center;justify-content:center">
      <div style="width:${side}px;height:${side}px">${job.svg.replace('<svg ', `<svg width="${side}" height="${side}" `)}</div></body></html>`);
    await page.screenshot({ path: job.out, omitBackground: false });
    console.log('wrote', path.relative(APP, job.out), job.w, job.h);
  }
  await browser.close();
})();
