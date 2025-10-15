// index.js
import 'dotenv/config';
import nodemailer from 'nodemailer';
import pino from 'pino';
import { chromium } from 'playwright';

const log = pino({ level: 'info' });

const {
  APPLE_STORE_ID = 'R756',                 // Apple Saket
  APPLE_PARTS = '',                        // comma-separated SKUs, e.g. MPUD3HN/A,MPUE3HN/A
  POLL_INTERVAL = '30000',                 // 30s
  APPLE_BOOT_URL = 'https://www.apple.com/in/shop/buy-iphone',

  SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM, MAIL_TO,
  PORT = '8080'
} = process.env;

if (!APPLE_PARTS) { log.error('Set APPLE_PARTS'); process.exit(1); }
['SMTP_HOST','SMTP_PORT','SMTP_USER','SMTP_PASS','MAIL_FROM','MAIL_TO'].forEach(k=>{
  if(!process.env[k]) { log.error(`Missing ${k}`); process.exit(1); }
});

const parts = APPLE_PARTS.split(',').map(s=>s.trim()).filter(Boolean);

const transporter = nodemailer.createTransport({
  host: SMTP_HOST,
  port: Number(SMTP_PORT),
  secure: false,
  auth: { user: SMTP_USER, pass: SMTP_PASS },
});

function buildAppleUrl(part, storeId) {
  const base = 'https://www.apple.com/in/shop/fulfillment-messages';
  const q = new URLSearchParams({
    pl: 'true',
    searchNearby: 'false',
    store: storeId,
    'mts.0': 'regular',
    _: String(Date.now())
  });
  q.append('parts.0', part);
  return `${base}?${q.toString()}`;
}

function parseAvailability(json, part) {
  try {
    const stores = json?.body?.content?.pickupMessage?.stores;
    const pa = stores?.[0]?.partsAvailability?.[part];
    const available = !!(pa?.pickupsAvailable) || pa?.pickupDisplay === 'available';
    const quote = pa?.storePickupQuote || pa?.pickupSearchQuote || '—';
    return { available, quote };
  } catch { return { available:false, quote:'Parse error' }; }
}

const lastState = new Map(); // part -> boolean

async function run() {
  // Headless Chromium handles cookies & JS for us
  const browser = await chromium.launch({ args: ['--no-sandbox','--disable-dev-shm-usage'] });
  const ctx = await browser.newContext();     // storage persists only for this process
  const page = await ctx.newPage();

  // Bootstrap cookies once
  await page.goto(APPLE_BOOT_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(1000);

  async function checkOnce() {
    for (const part of parts) {
      try {
        // Call Apple’s JSON endpoint *from the page* so it carries session cookies automatically
        const url = buildAppleUrl(part, APPLE_STORE_ID);
        const data = await page.evaluate(async (u) => {
          const res = await fetch(u, {
            headers: {
              'Accept': 'application/json,text/javascript,*/*;q=0.01',
              'X-Requested-With': 'XMLHttpRequest'
            },
            credentials: 'include'
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json();
        }, url);

        const { available, quote } = parseAvailability(data, part);
        const prev = lastState.get(part) ?? false;

        if (available && !prev) {
          lastState.set(part, true);
          await transporter.sendMail({
            from: MAIL_FROM, to: MAIL_TO,
            subject: `✅ iPhone available at Apple Saket for ${part}`,
            text: `Part: ${part}\nStore: Apple Saket (R756)\nStatus: AVAILABLE\nQuote: ${quote}\n\nhttps://www.apple.com/in/shop/buy-iphone`,
          });
          log.info({ part, quote }, 'AVAILABLE — email sent');
        } else {
          lastState.set(part, available);
          log.info({ part, available, quote }, 'Checked');
        }
      } catch (e) {
        log.warn({ part, msg: e?.message }, 'Check failed');
        // If the session gets weird, quietly re-bootstrap:
        try {
          await page.goto(APPLE_BOOT_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
          await page.waitForTimeout(800);
        } catch {}
      }
    }
  }

  // loop
  await checkOnce();
  setInterval(checkOnce, Number(POLL_INTERVAL));
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});

// Tiny health server for Render (optional)
import http from 'http';
http.createServer((_req, res) => { res.writeHead(200); res.end('ok'); })
  .listen(Number(PORT));
