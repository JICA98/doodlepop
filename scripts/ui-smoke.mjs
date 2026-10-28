// Browser smoke test: two real browser pages play through a round via the UI.
// Needs Chrome: CHROME_PATH=/usr/bin/google-chrome node scripts/ui-smoke.mjs   (server on :8787, built web)
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE ?? 'http://localhost:8787';
const CHROME = process.env.CHROME_PATH ?? '/usr/bin/google-chrome';
mkdirSync('/tmp/shots', { recursive: true });
let failures = 0;
const ok = (c, m) => { console.log(c ? '  ✓' : '  ✗ FAIL:', m); if (!c) failures++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
const newPage = async (name, mobile = false) => {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport(mobile ? { width: 390, height: 780, isMobile: true, hasTouch: true } : { width: 1280, height: 800 });
  page.on('pageerror', (e) => { failures++; console.log(`  ✗ page error (${name}):`, e.message); });
  page.on('console', (m) => m.type() === 'error' && console.log(`  console.error (${name}):`, m.text()));
  return page;
};
const clickText = async (page, text) => {
  await page.waitForFunction((t) => [...document.querySelectorAll('button')].some((b) => b.textContent.includes(t) && !b.disabled), { timeout: 8000 }, text);
  await page.evaluate((t) => [...document.querySelectorAll('button')].find((b) => b.textContent.includes(t) && !b.disabled).click(), text);
};
const nonWhite = (page) => page.evaluate(() => {
  const c = document.querySelector('canvas'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 250 || d[i + 1] < 250 || d[i + 2] < 250) n++; return n;
});

try {
  console.log('== UI: private room ==');
  const p1 = await newPage('host');
  await p1.goto(BASE);
  await p1.screenshot({ path: '/tmp/shots/01-home.png' });
  await p1.type('input[aria-label=Nickname]', 'Hosty');
  await clickText(p1, 'Create private room');
  await p1.waitForSelector('.lobby');
  ok(true, 'host lands in lobby');
  const link = await p1.$eval('input[aria-label="Invite link"]', (e) => e.value);
  ok(/\?room=[a-z0-9]{8}$/.test(link), `invite link ${link}`);

  const p2 = await newPage('guest', true);
  await p2.goto(link.replace(/^https?:\/\/[^/]+/, BASE));
  await p2.waitForSelector('.invite-banner');
  ok(true, 'invite link shows join banner');
  await p2.type('input[aria-label=Nickname]', 'Guesty');
  await p2.screenshot({ path: '/tmp/shots/02-home-mobile.png' });
  await clickText(p2, 'Join room');
  await p2.waitForSelector('.game');
  await p1.waitForFunction(() => document.querySelectorAll('.player').length === 2);
  ok(true, 'both players visible in host list');
  await p1.screenshot({ path: '/tmp/shots/03-lobby.png' });
  await p2.screenshot({ path: '/tmp/shots/04-lobby-mobile.png' });

  // host config: 1 round, wordCount 1 to skip choice? keep default (3 choices) to test the overlay
  await p1.select('.settings-grid select:nth-of-type(1)', 'en');
  await clickText(p1, 'Start game');
  const pages = [p1, p2];
  await Promise.all(pages.map((p) => p.waitForFunction(() => document.querySelector('.overlay'), { timeout: 5000 })));
  const drawerPage = (await p1.$('.choices')) ? p1 : p2;
  const guesserPage = drawerPage === p1 ? p2 : p1;
  await drawerPage.screenshot({ path: '/tmp/shots/05-choose.png' });
  const word = await drawerPage.$eval('.choice', (b) => b.textContent);
  await drawerPage.click('.choice');
  await Promise.all(pages.map((p) => p.waitForFunction(() => document.querySelector('.clock') && !document.querySelector('.overlay'), { timeout: 5000 })));
  ok(true, `drawing started, word "${word}"`);
  ok((await drawerPage.$('.toolbar')) !== null && (await guesserPage.$('.toolbar')) === null, 'only drawer has tools');

  const box = await (await drawerPage.$('canvas')).boundingBox();
  await drawerPage.mouse.move(box.x + 50, box.y + 50);
  await drawerPage.mouse.down();
  for (let i = 0; i < 25; i++) await drawerPage.mouse.move(box.x + 50 + i * 12, box.y + 60 + Math.sin(i / 3) * 50);
  await drawerPage.mouse.up();
  // pick a colour + fill
  await drawerPage.click('.swatch:nth-child(3)');
  await drawerPage.click('.tool[title=Fill]');
  await drawerPage.mouse.click(box.x + box.width - 40, box.y + box.height - 40);
  await sleep(600);
  const a = await nonWhite(drawerPage), b = await nonWhite(guesserPage);
  ok(a > 500 && Math.abs(a - b) / a < 0.02, `drawing synced to guesser (drawer ${a}px, guesser ${b}px non-white)`);
  await guesserPage.screenshot({ path: '/tmp/shots/06-guesser.png' });
  await drawerPage.screenshot({ path: '/tmp/shots/07-drawer.png' });

  // undo then clear sync
  await drawerPage.click('.tool[title=Undo]');
  await sleep(400);
  const a2 = await nonWhite(drawerPage), b2 = await nonWhite(guesserPage);
  ok(a2 < a && Math.abs(a2 - b2) / Math.max(a2, 1) < 0.02, `undo synced (${a}→${a2} / ${b2})`);

  // guess wrong then right
  await guesserPage.type('input[aria-label="Chat or guess"]', 'zzzwrongzzz');
  await guesserPage.keyboard.press('Enter');
  await guesserPage.type('input[aria-label="Chat or guess"]', word);
  await guesserPage.keyboard.press('Enter');
  await Promise.all(pages.map((p) => p.waitForSelector('.the-word', { timeout: 5000 })));
  ok((await guesserPage.$eval('.the-word', (e) => e.textContent.toLowerCase())) === word.toLowerCase(), 'reveal overlay shows the word after a correct guess');
  await guesserPage.screenshot({ path: '/tmp/shots/08-reveal.png' });
  const scoreText = await p1.$$eval('.pscore', (els) => els.map((e) => e.textContent));
  ok(scoreText.every((t) => /[1-9]\d* pts/.test(t)), `both players scored (${scoreText.join(' | ')})`);

  console.log('== UI: refresh keeps seat ==');
  await p2.reload();
  await p2.waitForSelector('.game .player', { timeout: 8000 });
  await p2.waitForFunction(() => document.querySelectorAll('.player').length === 2);
  const names = await p2.$$eval('.pname', (e) => e.map((x) => x.textContent));
  ok(names.length === 2, `refresh rejoined same seat, no duplicate (${names.join(', ')})`);

  console.log('== UI: quick play ==');
  const q1 = await newPage('q1');
  await q1.goto(BASE);
  await q1.type('input[aria-label=Nickname]', 'Quick1');
  await q1.select('select[aria-label=Language]', 'fr'); // distinct language pool → isolated from other tests
  await clickText(q1, 'Play!');
  await q1.waitForSelector('.game', { timeout: 8000 });
  ok(true, 'quick play lands in a public room');
  const q2 = await newPage('q2', true);
  await q2.goto(BASE);
  await q2.type('input[aria-label=Nickname]', 'Quick2');
  await q2.select('select[aria-label=Language]', 'fr');
  await clickText(q2, 'Play!');
  await q2.waitForSelector('.game', { timeout: 15000 });
  await q1.waitForFunction(() => document.querySelectorAll('.player:not(.offline)').length >= 2, { timeout: 8000 });
  ok((await q1.url()) === (await q2.url()), 'two quick-play users matched into the same room');
  await q1.screenshot({ path: '/tmp/shots/09-public-lobby.png' });
} catch (e) {
  failures++;
  console.error('ERROR', e.message);
  for (const [i, pg] of (await browser.pages()).entries()) await pg.screenshot({ path: `/tmp/shots/fail-${i}.png` }).catch(() => {});
}
await browser.close();
console.log(failures ? `${failures} FAILURE(S)` : 'UI SMOKE PASSED');
process.exit(failures ? 1 : 0);
