// Foxpin Telegram welcome bot (Node.js 18+, no extra packages needed).
// When someone taps Start, it replies with the banner, a welcome text and a "Play!" button that opens your app.
// Everything is already filled in below. Render also provides PORT and RENDER_EXTERNAL_URL by itself,
// so nothing needs to be set in Render and nothing needs to be installed by hand.

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// ---- Settings (hard-coded; an environment variable of the same name would override it) ----
const BOT_TOKEN = process.env.BOT_TOKEN || "9131347824:AAF6sfLPqqcKwQdOILRsKzex1xuqKLFpHlw";
const APP_URL = process.env.APP_URL || "https://foxpin.netlify.app";
const APP_LINK = (process.env.APP_LINK || "").replace(/\/$/, ""); // optional Mini App link, e.g. https://t.me/foxpin_bot/play
// ------------------------------------------------------------------------------------------

const PUBLIC_URL = (process.env.WEBHOOK_URL || process.env.RENDER_EXTERNAL_URL || "").replace(/\/$/, "");
const PORT = process.env.PORT || 10000;
const IMAGE = path.join(__dirname, "foxpin-640x360.png");

// Telegram sends this value back with every update so we can reject fake requests.
// It is derived from the token, so you do not need to create another secret.
const SECRET = crypto.createHash("sha256").update(BOT_TOKEN).digest("hex").slice(0, 32);

const CAPTION =
  "Welcome to Foxpin! 🦊\n\n" +
  "Play games, earn coins and diamonds, and cash out from $100.\n" +
  "Tap Play to start earning!";

const API = `https://api.telegram.org/bot${BOT_TOKEN}`;

async function tg(method, payload) {
  const res = await fetch(`${API}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.json();
}

let photoId = null; // after the first upload Telegram gives an id we can reuse

async function sendWelcome(chatId, payload) {
  const validPayload = /^[A-Za-z0-9_-]{1,64}$/.test(payload);
  const button =
    validPayload && APP_LINK
      ? { text: "Play! 🎮", url: `${APP_LINK}?startapp=${payload}` } // passes the referral code to the app
      : { text: "Play! 🎮", web_app: { url: APP_URL } }; // opens the app right inside Telegram
  const markup = { inline_keyboard: [[button]] };

  if (photoId) {
    const r = await tg("sendPhoto", { chat_id: chatId, photo: photoId, caption: CAPTION, reply_markup: markup });
    if (r.ok) return;
    photoId = null;
  }

  try {
    const form = new FormData();
    form.append("chat_id", String(chatId));
    form.append("caption", CAPTION);
    form.append("reply_markup", JSON.stringify(markup));
    form.append("photo", new Blob([fs.readFileSync(IMAGE)], { type: "image/png" }), "foxpin.png");
    const r = await (await fetch(`${API}/sendPhoto`, { method: "POST", body: form })).json();
    if (r.ok) {
      photoId = r.result.photo[r.result.photo.length - 1].file_id;
      return;
    }
    console.error("sendPhoto failed:", r);
  } catch (e) {
    console.error("Could not send the image:", e.message);
  }

  // last resort: plain text message with the button
  await tg("sendMessage", { chat_id: chatId, text: CAPTION, reply_markup: markup });
}

async function handleUpdate(update) {
  const msg = update.message;
  if (!msg || typeof msg.text !== "string") return;
  if (/^\/start(@\w+)?(\s|$)/.test(msg.text)) {
    const payload = (msg.text.split(/\s+/)[1] || "").trim();
    await sendWelcome(msg.chat.id, payload);
  }
}

const server = http.createServer((req, res) => {
  if (req.method === "POST" && req.url === "/webhook") {
    if (req.headers["x-telegram-bot-api-secret-token"] !== SECRET) {
      res.writeHead(403);
      return res.end();
    }
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1e6) req.destroy();
    });
    req.on("end", () => {
      res.writeHead(200);
      res.end("ok");
      try {
        handleUpdate(JSON.parse(body)).catch((e) => console.error(e));
      } catch (e) {
        console.error("Bad update:", e.message);
      }
    });
    return;
  }
  // any other visit (for example opening the Render link in a browser)
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Foxpin bot is running");
});

server.listen(PORT, "0.0.0.0", async () => {
  console.log(`Listening on port ${PORT}`);
  if (!PUBLIC_URL) {
    console.warn("No public URL found. Set WEBHOOK_URL to your Render address so Telegram knows where to send messages.");
    return;
  }
  // Tells Telegram: send every message for this bot to this address.
  const r = await tg("setWebhook", {
    url: `${PUBLIC_URL}/webhook`,
    secret_token: SECRET,
    allowed_updates: ["message"],
  });
  console.log("setWebhook:", JSON.stringify(r));
});
