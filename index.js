// index.js

require("dotenv").config();
const axios = require("axios");
const nodemailer = require("nodemailer");

// --- Configuration ---
const STORE_ID = process.env.STORE_ID;
const SKU_ID = process.env.SKU_ID;

// Replace with the actual Apple API endpoint for store availability
const API_ENDPOINT = `https://www.apple.com/in/shop/fulfillment-messages?parts.0=${SKU_ID}&search-location=${STORE_ID}`;

const headers = {
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  accept: "application/json, text/plain, */*",
  "accept-language": "en-US,en;q=0.9",
  Cookie: process.env.APPLE_COOKIE,
  // cookie: process.env.APPLE_COOKIE,
};

const CHECK_INTERVAL_MS = 30 * 1000; // 30 seconds
const RECIPIENT_EMAIL = process.env.RECIPIENT_EMAIL;

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.GMAIL_USER, // Your Gmail address
    pass: process.env.GMAIL_PASSWORD, // Use an App Password, NOT your regular password
  },
});

/**
 * Sends an email notification about the availability.
 */
async function sendAvailabilityEmail(storeName, modelName) {
  console.log("MAIL INFO: ", process.env.GMAIL_USER, RECIPIENT_EMAIL);
  const mailOptions = {
    from: process.env.GMAIL_USER,
    to: RECIPIENT_EMAIL,
    subject: `🚨 iPhone 17 AVAILABLE for Pickup at ${storeName}! 🚨`,
    text: `The ${modelName} is now available for pickup at the ${storeName}. Check the Apple website immediately!`,
    html: `
            <h1>Iphone 17 AVAILABLE BROOOO!!!</h1>
            <p><strong>Store:</strong> ${storeName}</p>
        `,
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log(
      `[${new Date().toLocaleTimeString()}] Email notification sent successfully to ${RECIPIENT_EMAIL}`
    );
  } catch (error) {
    console.error("Error sending email:", error);
  }
}

async function checkAvailability() {
  console.log(`[${new Date().toLocaleTimeString()}] Checking availability...`);

  try {
    const response = await axios.get(API_ENDPOINT, {
      headers: headers,
    });
    const data = response.data;

    const storeInfo = data.body.content.pickupMessage.stores.find(
      (store) => store.storeNumber === STORE_ID
    );

    console.info("data", storeInfo.partsAvailability[SKU_ID]);

    const isAvailable =
      storeInfo.partsAvailability[SKU_ID].buyability.isBuyable;

    if (isAvailable) {
      console.log(
        `✅ [${new Date().toLocaleTimeString()}] iPhone 17 is AVAILABLE! Sending email.`
      );
      await sendAvailabilityEmail(storeInfo.storeName, "iPhone 17 Pro Max");
      // OPTIONAL: Clear the interval after sending the email to stop checking
      // clearInterval(intervalId);
    } else {
      console.log(
        `❌ [${new Date().toLocaleTimeString()}] Not available. Next check in 30s.`
      );
    }
  } catch (error) {
    console.error(
      `[${new Date().toLocaleTimeString()}] Error fetching data:`,
      error.message
    );
  }
}

// Start the initial check immediately
checkAvailability();

// Set up the interval to run every 30 seconds
const intervalId = setInterval(checkAvailability, CHECK_INTERVAL_MS);

// Keep the Node.js process alive (important for deployment platforms)
console.log("Stock checker started. Checking every 30 seconds...");
