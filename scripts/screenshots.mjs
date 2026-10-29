// Captures README screenshots into docs/screenshots using two real browser pages.
// Needs Chrome + a server on :8787 with a built UI:
//   npm run build && npm run dev:api   (other terminal)   then   npm run screenshots
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE ?? 'http://localhost:8787';
const CHROME = process.env.CHROME_PATH ?? '/usr/bin/google-chrome';
const OUT = 'docs/screenshots';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
const newPage = async (mobile) => {
  const page = await (await browser.createBrowserContext()).newPage();
  await page.setViewport(mobile ? { width: 390, height: 780, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { width: 1280, height: 800 });
  return page;
};
const clickText = async (page, text) => {
  await page.waitForFunction((t) => [...document.querySelectorAll('button')].some((b) => b.textContent.includes(t) && !b.disabled), { timeout: 8000 }, text);
  await page.evaluate((t) => [...document.querySelectorAll('button')].find((b) => b.textContent.includes(t) && !b.disabled).click(), text);
};
// Set a <select> found by its label text (fires the change event Preact listens to).
const setSelect = (page, label, value) =>
  page.evaluate((l, v) => {
    const sel = [...document.querySelectorAll('label.setting')].find((x) => x.textContent.includes(l))?.querySelector('select');
    sel.value = v;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  }, label, String(value));
const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png` });

try {
  const host = await newPage(false);
  await host.goto(BASE);
  await host.type('input[aria-label=Nickname]', 'Nova');
  await sleep(300);
  await shot(host, '01-home');

  await clickText(host, 'Create private room');
  await host.waitForSelector('.lobby');
  const link = await host.$eval('input[aria-label="Invite link"]', (e) => e.value);

  const guest = await newPage(true);
  await guest.goto(link.replace(/^https?:\/\/[^/]+/, BASE));
  await guest.type('input[aria-label=Nickname]', 'Pixel');
  await clickText(guest, 'Join room');
  await host.waitForFunction(() => document.querySelectorAll('.player').length === 2);

  // Deterministic word: custom words only, one choice → straight to drawing.
  await setSelect(host, 'Word choices', 1);
  await host.evaluate(() => {
    const cb = document.querySelector('.setting.check input');
    cb.click();
  });
  await host.type('textarea', 'house');
  await host.evaluate(() => document.querySelector('textarea').blur());
  await sleep(500);
  await shot(host, '02-lobby');

  await clickText(host, 'Start game');
  await host.waitForSelector('.toolbar', { timeout: 8000 });
  const box = await (await host.$('canvas')).boundingBox();
  const at = (x, y) => [box.x + (x / 800) * box.width, box.y + (y / 600) * box.height];
  const stroke = async (color, size, pts) => {
    await host.click(`.swatch[aria-label="Color ${color}"]`);
    await host.evaluate((s) => [...document.querySelectorAll('.size')].find((b) => b.getAttribute('aria-label') === `Size ${s}`).click(), size);
    await host.mouse.move(...at(...pts[0]));
    await host.mouse.down();
    for (const p of pts.slice(1)) await host.mouse.move(...at(...p), { steps: 6 });
    await host.mouse.up();
  };
  await stroke('#000000', 10, [[250, 330], [550, 330], [550, 520], [250, 520], [250, 330]]); // walls
  await stroke('#ef130b', 10, [[220, 340], [400, 190], [580, 340], [220, 340]]); // roof
  await stroke('#000000', 10, [[370, 520], [370, 420], [430, 420], [430, 520]]); // door
  await stroke('#ffe400', 10, [[690, 90], [700, 90]]); // sun
  await host.click('.swatch[aria-label="Color #00b2ff"]');
  await host.click('.tool[title=Fill]');
  await host.mouse.click(...at(120, 60)); // sky
  await host.click('.swatch[aria-label="Color #e8a200"]');
  await host.mouse.click(...at(400, 260)); // roof interior
  await host.click('.swatch[aria-label="Color #00cc00"]');
  await host.mouse.click(...at(80, 570)); // grass
  await sleep(700);

  await guest.type('input[aria-label="Chat or guess"]', 'cabin');
  await guest.keyboard.press('Enter');
  await host.type('input[aria-label="Chat or guess"]', 'nice weather');
  await host.keyboard.press('Enter');
  await sleep(600);
  await shot(host, '03-drawing');
  await shot(guest, '04-guesser-mobile');

  await guest.type('input[aria-label="Chat or guess"]', 'house');
  await guest.keyboard.press('Enter');
  await host.waitForSelector('.the-word', { timeout: 5000 });
  await sleep(400);
  await shot(host, '05-reveal');
  console.log('screenshots written to', OUT);
} catch (e) {
  console.error('FAILED', e.message);
  process.exitCode = 1;
}
await browser.close();
