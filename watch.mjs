// watch.js
import "dotenv/config";
import { chromium } from "playwright";
import pino from "pino";

const log = pino({ level: "info" });

const {
  APPLE_URL,
  CHECK_SELECTOR = ".rf-pickup-quote-value",
  POLL_MS = "60000",
  HEADLESS = "true",
  STORE_NAME = "Apple Saket",
} = process.env;

if (!APPLE_URL) {
  console.error("Add APPLE_URL in .env");
  process.exit(1);
}

const headless = /^true$/i.test(HEADLESS);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function getAvailability(page) {
  
  await page.waitForSelector(CHECK_SELECTOR, { timeout: 20000 });
  // Use Playwright's $eval to inspect nested span when available
  return page.$eval(
    CHECK_SELECTOR,
    (root, storeName) => {
      console.info('root', root, 'storeName', storeName);
      const text = (root.textContent || "").trim();

      // availability word span appears only when available (e.g., "Today", "Tomorrow")
      const readyEl = root.querySelector(".as-pickup-quote-availability-quote");
      const readinessWord = readyEl ? (readyEl.textContent || "").trim() : null;

      // sanity check for correct store
      const mentionsStore = new RegExp(storeName, "i").test(text);

      return {
        available: Boolean(readyEl) && mentionsStore,
        readinessWord,
        text,
      };
    },
    STORE_NAME
  );
}

async function notifyAvailable(readinessWord, text) {
  const message = readinessWord
    ? `Pickup: ${readinessWord} at ${STORE_NAME}`
    : text;

  log.info(`🎉 AVAILABLE → ${message}`);
}

(async () => {
  const browser = await chromium.launch({
    headless,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const context = await browser.newContext({
    locale: "en-IN",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari",
  });
  const page = await context.newPage();

  log.info(`Opening ${APPLE_URL}`);
  await page.goto(APPLE_URL, { waitUntil: "domcontentloaded", timeout: 45000 });

  let lastText = "";

  // single function that ONLY checks; navigation handled outside
  async function checkOnce() {
    try {
      const { available, readinessWord, text } = await getAvailability(page);

      if (text !== lastText) {
        log.info({ text }, "pickup text changed");
        lastText = text;
      }

      if (available) {
        await page.screenshot({
          path: `available-${Date.now()}.png`,
          fullPage: true,
        });
        await notifyAvailable(readinessWord, text);
      } else {
        log.info(`❌ Unavailable: ${text}`);
      }
    } catch (e) {
      log.warn({ msg: e?.message }, "check failed");
    }
  }

  // first check
  await checkOnce();

  // safer loop than setInterval (prevents overlap)
  while (true) {
    await sleep(Number(POLL_MS));
    try {
      await page.reload({
        waitUntil: "domcontentloaded",
        timeout: 45000,
      });
    } catch (e) {
      log.warn({ msg: e?.message }, "reload failed; retrying next cycle");
    }
    await checkOnce();
  }
})();
