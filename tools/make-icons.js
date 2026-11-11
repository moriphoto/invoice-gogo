// Regenerates the PNG icons from the SVGs using headless Chrome.  NODE_PATH=<dir with puppeteer-core> node tools/make-icons.js
const puppeteer = require('puppeteer-core'); const fs = require('fs'); const path = require('path'); const root = path.join(__dirname, '..');
(async () => {
  const b = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] }); const pg = await b.newPage();
  for (const [svg, out, size] of [['icon.svg', 'icon-192.png', 192], ['icon.svg', 'icon-512.png', 512], ['icon-maskable.svg', 'apple-touch-icon.png', 180], ['icon-maskable.svg', 'icon-maskable-512.png', 512]]) {
    const s = fs.readFileSync(path.join(root, svg), 'utf8'); await pg.setViewport({ width: size, height: size });
    await pg.setContent(`<body style="margin:0;background:transparent">${s.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body>`); await pg.screenshot({ path: path.join(root, out), omitBackground: true });
  }
  await b.close();
})();
