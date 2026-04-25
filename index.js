require("dotenv").config();
const TelegramBot = require("node-telegram-bot-api");
const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const {
  parseTrackCommand,
  addPriceTrack,
  findTriggeredPriceTracks,
  formatPriceTrackSetMessage,
  formatPriceTrackTriggeredMessage,
} = require("./track-alerts");

// --- Config ---
const {
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID,
  PRL_PAIR_ADDRESS = "DYxp5fh3Eh7iDEVHv9bFLGnPwvXwFe5YWpGayJuzzbgd",
  PRL_PERP_SYMBOL = "PRLUSDT",
  POLL_INTERVAL_SECONDS = "120",
  COOLDOWN_HOURS = "4",
  THRESHOLD_STEP_M = "25",
} = process.env;

if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
  console.error("Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID in .env");
  process.exit(1);
}

const VERSION = "1.0.1.0";
const POLL_MS = Number(POLL_INTERVAL_SECONDS) * 1000;
const COOLDOWN_MS = Number(COOLDOWN_HOURS) * 60 * 60 * 1000;
const STEP = Number(THRESHOLD_STEP_M) * 1_000_000;

// --- State (persisted to disk) ---
const STATE_FILE = path.join(__dirname, "state.json");
const loadedState = loadState();
let alertHistory = loadedState.alertHistory;
let priceTracks = loadedState.priceTracks;

function loadState() {
  try {
    const data = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));

    // Legacy state.json was a plain threshold-history object: { "25000000:up": 123 }
    if (!data || Array.isArray(data) || !Object.prototype.hasOwnProperty.call(data, "alertHistory")) {
      return { alertHistory: new Map(Object.entries(data || {})), priceTracks: [] };
    }

    return {
      alertHistory: new Map(Object.entries(data.alertHistory || {})),
      priceTracks: Array.isArray(data.priceTracks) ? data.priceTracks : [],
    };
  } catch {
    return { alertHistory: new Map(), priceTracks: [] };
  }
}

function saveState() {
  const obj = {
    alertHistory: Object.fromEntries(alertHistory),
    priceTracks,
  };
  fs.writeFileSync(STATE_FILE, JSON.stringify(obj, null, 2));
}

// --- Telegram (webhook mode for commands) ---
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN);
let alertsEnabled = true;

async function sendAlert(fdv, threshold, direction, price) {
  const fdvStr = formatM(fdv);
  const threshStr = formatM(threshold);
  const arrow = direction === "up" ? "above" : "below";
  const emoji = direction === "up" ? "\u{1F4C8}" : "\u{1F4C9}";
  const oiRows = Number.isFinite(price) ? await getOpenInterest(price) : [];
  const oiBlock = oiRows.length ? `${formatOpenInterest(oiRows)}\n\n` : "";

  const msg =
    `${emoji} *$PRL FDV Alert*\n\n` +
    `FDV crossed *${arrow} ${threshStr}*\n` +
    `Current FDV: *${fdvStr}*\n\n` +
    `_Cooldown: ${COOLDOWN_HOURS}h before re-alerting this level_\n\n` +
    oiBlock +
    `_v${VERSION}_`;

  try {
    await bot.sendMessage(TELEGRAM_CHAT_ID, msg, { parse_mode: "Markdown" });
    console.log(`[${ts()}] Alert sent: ${arrow} ${threshStr} (FDV: ${fdvStr})`);
  } catch (err) {
    console.error("Failed to send Telegram message:", err.message);
  }
}

function formatM(value) {
  return `$${(value / 1_000_000).toFixed(2)}M`;
}

function formatCompact(value, prefix = "") {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "N/A";
  const n = Number(value);
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `${prefix}${(n / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${prefix}${(n / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${prefix}${(n / 1_000).toFixed(2)}K`;
  return `${prefix}${n.toFixed(2)}`;
}

function ts() {
  return new Date().toISOString();
}

// --- DexScreener price fetching (free, no rate limits) ---

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const req = https
      .get(url, { headers: { "User-Agent": "TG-Perle-Alert/1.0" } }, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          if (res.statusCode === 429) {
            reject(new Error("Rate limit hit — will retry next poll"));
            return;
          }
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 120)}`));
            return;
          }
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`JSON parse error: ${e.message}`));
          }
        });
      })
      .on("error", reject);

    req.setTimeout(10000, () => {
      req.destroy(new Error("Request timed out"));
    });
  });
}

async function getFDV() {
  const url = `https://api.dexscreener.com/latest/dex/pairs/solana/${PRL_PAIR_ADDRESS}`;
  const data = await fetchJSON(url);

  const pair = data?.pairs?.[0] || data?.pair;
  if (!pair) throw new Error("Could not find $PRL pair on DexScreener");

  const fdv = pair.fdv;
  const price = Number(pair.priceUsd);
  if (!fdv || fdv <= 0) throw new Error(`Invalid FDV: ${fdv}`);

  return { fdv, price };
}

async function fetchCoinGeckoOpenInterest() {
  const symbol = PRL_PERP_SYMBOL.toUpperCase();
  const data = await fetchJSON("https://api.coingecko.com/api/v3/derivatives?include_tickers=all");
  if (!Array.isArray(data)) throw new Error("Invalid CoinGecko derivatives response");

  const marketMap = new Map([
    ["Binance (Futures)", "Binance"],
    ["Bybit (Futures)", "Bybit"],
    ["Bitget Futures", "Bitget"],
  ]);
  const rows = new Map();

  for (const item of data) {
    const exchange = marketMap.get(item?.market);
    const itemSymbol = String(item?.symbol || "").replace(/[^A-Z0-9]/gi, "").toUpperCase();
    const openInterest = Number(item?.open_interest);
    if (exchange && itemSymbol.includes(symbol) && Number.isFinite(openInterest)) {
      rows.set(exchange, {
        exchange,
        notional: openInterest,
        source: "CoinGecko",
        updatedAt: item?.last_traded_at,
      });
    }
  }

  return rows;
}

async function fetchBitgetOpenInterest(price) {
  const symbol = PRL_PERP_SYMBOL.toUpperCase();
  const data = await fetchJSON(
    `https://api.bitget.com/api/v2/mix/market/open-interest?symbol=${encodeURIComponent(symbol)}&productType=USDT-FUTURES`
  );
  const row = data?.data?.openInterestList?.[0];
  const amount = Number(row?.size);
  if (data?.code !== "00000" || !Number.isFinite(amount)) throw new Error(data?.msg || "Invalid Bitget OI response");
  return { exchange: "Bitget", amount, notional: amount * price, source: "Bitget" };
}

async function getOpenInterest(price) {
  const exchanges = ["Binance", "Bybit", "Bitget"];
  let coingeckoRows = new Map();

  try {
    coingeckoRows = await fetchCoinGeckoOpenInterest();
  } catch (err) {
    console.error(`[${ts()}] CoinGecko OI error:`, err.message || err);
  }

  const bitgetDirect = await fetchBitgetOpenInterest(price).catch((err) => {
    console.error(`[${ts()}] Bitget OI error:`, err.message || err);
    return null;
  });

  return exchanges.map((exchange) => {
    if (exchange === "Bitget" && bitgetDirect) return bitgetDirect;
    if (coingeckoRows.has(exchange)) return coingeckoRows.get(exchange);
    return { exchange, error: "unavailable" };
  });
}

function formatOpenInterest(oiRows) {
  const lines = oiRows.map((row) => {
    if (row.error) return `${row.exchange}: N/A`;
    if (Number.isFinite(row.amount)) return `${row.exchange}: ${formatCompact(row.amount)} PRL (${formatCompact(row.notional, "$")})`;
    return `${row.exchange}: ${formatCompact(row.notional, "$")} (${row.source})`;
  });

  return `*Open Interest*\n${lines.join("\n")}`;
}

// --- Threshold logic ---
let lastKnownFDV = null;
let lastKnownPrice = null;

function getThreshold(fdv) {
  return Math.floor(fdv / STEP) * STEP;
}

function checkThresholds(currentFDV) {
  const now = Date.now();
  const currentThreshold = getThreshold(currentFDV);

  // Clean up expired cooldowns
  for (const [key, timestamp] of alertHistory) {
    if (now - timestamp > COOLDOWN_MS) {
      alertHistory.delete(key);
    }
  }

  if (lastKnownFDV === null) {
    lastKnownFDV = currentFDV;
    console.log(`[${ts()}] Initial FDV: ${formatM(currentFDV)} (threshold: ${formatM(currentThreshold)})`);
    return [];
  }

  const prevThreshold = getThreshold(lastKnownFDV);
  const alerts = [];

  if (currentThreshold > prevThreshold) {
    for (let t = prevThreshold + STEP; t <= currentThreshold; t += STEP) {
      const key = `${t}:up`;
      if (!alertHistory.has(key) || now - alertHistory.get(key) > COOLDOWN_MS) {
        alerts.push({ threshold: t, direction: "up" });
        alertHistory.set(key, now);
      }
    }
  } else if (currentThreshold < prevThreshold) {
    for (let t = prevThreshold; t > currentThreshold; t -= STEP) {
      const key = `${t}:down`;
      if (!alertHistory.has(key) || now - alertHistory.get(key) > COOLDOWN_MS) {
        alerts.push({ threshold: t, direction: "down" });
        alertHistory.set(key, now);
      }
    }
  }

  lastKnownFDV = currentFDV;
  return alerts;
}

// --- Bot commands ---
bot.onText(/\/enable/, (msg) => {
  if (String(msg.chat.id) !== TELEGRAM_CHAT_ID) return;
  alertsEnabled = true;
  bot.sendMessage(msg.chat.id, "Alerts *enabled*.", { parse_mode: "Markdown" });
  console.log(`[${ts()}] Alerts enabled via /enable`);
});

bot.onText(/\/disable/, (msg) => {
  if (String(msg.chat.id) !== TELEGRAM_CHAT_ID) return;
  alertsEnabled = false;
  bot.sendMessage(msg.chat.id, "Alerts *disabled*.", { parse_mode: "Markdown" });
  console.log(`[${ts()}] Alerts disabled via /disable`);
});

bot.onText(/\/track(?:\s+.+)?/, async (msg) => {
  if (String(msg.chat.id) !== TELEGRAM_CHAT_ID) return;

  const parsed = parseTrackCommand(msg.text);
  if (!parsed.ok) {
    bot.sendMessage(msg.chat.id, parsed.error);
    return;
  }

  try {
    const { price } = await getFDV();
    const track = addPriceTrack(priceTracks, { targetPrice: parsed.targetPrice, currentPrice: price });
    saveState();
    bot.sendMessage(msg.chat.id, formatPriceTrackSetMessage(track, price, VERSION), { parse_mode: "Markdown" });
    console.log(`[${ts()}] /track set: ${track.direction} $${track.targetPrice.toFixed(6)} from $${price.toFixed(6)}`);
  } catch (err) {
    bot.sendMessage(msg.chat.id, `Error setting price track: ${err.message}`);
  }
});

bot.onText(/\/update/, async (msg) => {
  if (String(msg.chat.id) !== TELEGRAM_CHAT_ID) return;
  try {
    const { fdv, price } = await getFDV();
    const oiRows = await getOpenInterest(price);
    const threshold = getThreshold(fdv);
    const nextUp = formatM(threshold + STEP);
    const nextDown = threshold > 0 ? formatM(threshold) : "N/A";
    const status = alertsEnabled ? "ON" : "OFF";

    const text =
      `*$PRL Live Update*\n\n` +
      `Price: *$${price.toFixed(6)}*\n` +
      `FDV: *${formatM(fdv)}*\n\n` +
      `Next alert up: *${nextUp}*\n` +
      `Next alert down: *${nextDown}*\n` +
      `Alerts: *${status}*\n\n` +
      `${formatOpenInterest(oiRows)}\n\n` +
      `_v${VERSION}_`;

    bot.sendMessage(msg.chat.id, text, { parse_mode: "Markdown" });
  } catch (err) {
    bot.sendMessage(msg.chat.id, `Error fetching price: ${err.message}`);
  }
});

// --- Main loop with backoff ---
let currentInterval = POLL_MS;

async function poll() {
  try {
    const { fdv, price } = await getFDV();
    console.log(`[${ts()}] FDV: ${formatM(fdv)} | Price: $${price.toFixed(6)}`);
    currentInterval = POLL_MS; // reset to normal on success

    if (priceTracks.length > 0) {
      const { triggered, remaining } = findTriggeredPriceTracks(priceTracks, {
        previousPrice: lastKnownPrice,
        currentPrice: price,
      });
      if (triggered.length > 0) {
        priceTracks = remaining;
        saveState();
        for (const track of triggered) {
          await bot.sendMessage(TELEGRAM_CHAT_ID, formatPriceTrackTriggeredMessage(track, price, VERSION), {
            parse_mode: "Markdown",
          });
          console.log(`[${ts()}] /track triggered: ${track.direction} $${track.targetPrice.toFixed(6)}`);
        }
      }
    }
    lastKnownPrice = price;

    const alerts = checkThresholds(fdv);

    if (alerts.length > 0 && alertsEnabled) {
      saveState();
      for (const { threshold, direction } of alerts) {
        await sendAlert(fdv, threshold, direction, price);
      }
    }
  } catch (err) {
    console.error(`[${ts()}] Poll error:`, err.message);
    if (err.message.includes("rate limit")) {
      currentInterval = Math.min(currentInterval * 2, 10 * 60 * 1000); // back off, max 10min
      console.log(`[${ts()}] Backing off to ${currentInterval / 1000}s`);
    }
  }
  scheduleNext();
}

function scheduleNext() {
  setTimeout(poll, currentInterval);
}

// --- HTTP server (health + Telegram webhook) ---
const PORT = process.env.PORT || 3000;
const RENDER_URL = process.env.RENDER_EXTERNAL_URL;
const WEBHOOK_PATH = `/webhook/${TELEGRAM_BOT_TOKEN}`;

http.createServer((req, res) => {
  if (req.method === "POST" && req.url === WEBHOOK_PATH) {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const update = JSON.parse(body);
        bot.processUpdate(update);
      } catch (e) {
        console.error("Webhook parse error:", e.message);
      }
      res.writeHead(200);
      res.end("ok");
    });
  } else {
    const fdvStr = lastKnownFDV ? formatM(lastKnownFDV) : "pending...";
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end(`TG-Perle-Alert running | FDV: ${fdvStr}`);
  }
}).listen(PORT, () => {
  console.log(`Server on port ${PORT}`);
  // Register webhook with Telegram (retry until it sticks)
  if (RENDER_URL) {
    const webhookUrl = `${RENDER_URL}${WEBHOOK_PATH}`;
    const setWebhook = () => {
      const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook?url=${encodeURIComponent(webhookUrl)}`;
      https.get(url, (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            const r = JSON.parse(data);
            if (r.ok) {
              console.log("Webhook set: success");
            } else {
              console.error("Webhook set failed:", r.description, "— retrying in 10s");
              setTimeout(setWebhook, 10000);
            }
          } catch (e) {
            console.error("Webhook response parse error — retrying in 10s");
            setTimeout(setWebhook, 10000);
          }
        });
      }).on("error", (e) => {
        console.error("Webhook request failed:", e.message, "— retrying in 10s");
        setTimeout(setWebhook, 10000);
      });
    };
    setWebhook();
  }
});

// Self-ping every 14 min to prevent Render free tier from sleeping
if (RENDER_URL) {
  setInterval(() => {
    https.get(RENDER_URL, (res) => res.resume()).on("error", () => {});
  }, 14 * 60 * 1000);
}

async function main() {
  console.log("=== TG-Perle-Alert ===");
  console.log(`DexScreener pair: ${PRL_PAIR_ADDRESS}`);
  console.log(`Polling every ${POLL_INTERVAL_SECONDS}s`);
  console.log(`Threshold step: ${THRESHOLD_STEP_M}M`);
  console.log(`Cooldown: ${COOLDOWN_HOURS}h`);
  console.log(`Chat ID: ${TELEGRAM_CHAT_ID}`);
  console.log("");

  await poll();
}

main();
