// poll.js (updated)

import axios from "axios";
import { CookieJar } from "tough-cookie";
import { wrapper } from "axios-cookiejar-support";

// Use puppeteer-extra and add the stealth plugin
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
puppeteer.use(StealthPlugin());

// ---- Your constants and buildUrl() function remain the same ----
const REFERER =
  "https://www.apple.com/in/shop/buy-iphone/iphone-17/6.3%22-display-256gb-lavender";
const PART = "MG6M4HN/A";
const STORE_ID = process.env.STORE_ID || "";
const SEARCH_LOCATION = process.env.SEARCH_LOCATION || "110001"; // Delhi PIN

function buildUrl() {
  const base = "https://www.apple.com/in/shop/fulfillment-messages";
  const parts = [
    `parts.0=${encodeURIComponent(PART)}`,
    "fae=true",
    "little=false",
    "mts.0=regular",
    "mts.1=sticky",
    "fts=true",
    "searchNearby=true",
  ];
  if (STORE_ID) parts.push(`store=${encodeURIComponent(STORE_ID)}`);
  else parts.push(`search-location=${encodeURIComponent(SEARCH_LOCATION)}`);
  return `${base}?${parts.join("&")}`;
}
const URL = buildUrl();

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- NEWER, MORE ROBUST POLLING LOOP ----
(async () => {
  console.log("Launching stealth browser for session...");
  const browser = await puppeteer.launch({
    headless: "new",
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-infobars",
      "--window-position=0,0",
      "--ignore-certifcate-errors",
      "--ignore-certifcate-errors-spki-list",
    ],
  });

  const page = await browser.newPage();

  // Set a consistent User-Agent and viewport
  await page.setUserAgent(USER_AGENT);
  await page.setViewport({ width: 1920, height: 1080 });

  const RESEED_MS = 45 * 60 * 1000; // 45 minutes
  let lastSeed = 0;

  const reseed = async () => {
    console.log("Seeding/reseeding cookies by navigating to the page...");
    try {
      await page.goto(REFERER, { waitUntil: "networkidle2", timeout: 60000 });
      // Add a small, human-like delay for any post-load scripts to run
      await sleep(3000 + Math.random() * 2000);
      console.log("Cookies seeded successfully.");
      lastSeed = Date.now();
    } catch (e) {
      console.warn("Error during cookie seeding navigation:", e.message);
      throw e;
    }
  };

  // Initial seed
  await reseed();

  while (true) {
    try {
      if (Date.now() - lastSeed > RESEED_MS) {
        console.log("Proactively reseeding session...");
        await reseed();
      }

      console.log(`[${new Date().toISOString()}] polling...`);

      // Use page.evaluate to run fetch inside the browser
      // We pass more realistic headers this time.
      const data = await page.evaluate(
        (url, referer, userAgent) => {
          return fetch(url, {
            headers: {
              Accept: "application/json, text/plain, */*",
              "Accept-Language": "en-US,en;q=0.9",
              Referer: referer,
              "User-Agent": userAgent,
              "x-requested-with": "XMLHttpRequest", // Crucial header for XHR calls
            },
          }).then((res) => {
            if (!res.ok) {
              return {
                error: true,
                status: res.status,
                statusText: res.statusText,
              };
            }
            return res.json();
          });
        },
        URL,
        REFERER,
        USER_AGENT
      );

      if (data.error) {
        throw new Error(
          `Browser fetch failed with status ${data.status} ${data.statusText}`
        );
      }

      const stores = data?.body?.content?.pickupMessage?.stores ?? [];
      console.log(`[${new Date().toISOString()}] stores=${stores.length}`);

      if (stores.length > 0) {
        const availableStores = stores.filter(
          (store) =>
            store.partsAvailability[PART]?.pickupDisplay !== "unavailable"
        );
        if (availableStores.length > 0) {
          console.log("🎉 SUCCESS! iPhone is available for pickup at:");
          availableStores.forEach((store) => {
            console.log(`  - ${store.storeName}`);
          });
        }
      }

      await sleep(45000 + Math.floor(Math.random() * 10000));
    } catch (e) {
      console.warn("Poll error:", e?.message || String(e));
      console.log("Attempting to recover by reseeding after a delay...");
      await sleep(15000);
      try {
        await reseed();
      } catch (seedError) {
        console.error(
          "Fatal: Could not recover session after error. Exiting.",
          seedError.message
        );
        await browser.close();
        process.exit(1);
      }
    }
  }
})();
