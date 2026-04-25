function formatPrice(price) {
  return `$${Number(price).toFixed(6)}`;
}

function parseTrackCommand(text) {
  const parts = String(text || "").trim().split(/\s+/);
  if (parts.length < 2) {
    return { ok: false, error: "Usage: /track <price>\nExample: /track 0.25" };
  }

  const raw = parts[1].replace(/^\$/, "").replace(/,/g, "");
  const targetPrice = Number(raw);
  if (!Number.isFinite(targetPrice) || targetPrice <= 0) {
    return { ok: false, error: "Please enter a valid positive price. Example: /track 0.25" };
  }

  return { ok: true, targetPrice };
}

function addPriceTrack(tracks, { targetPrice, currentPrice, chatId, now = Date.now() }) {
  const direction = targetPrice >= currentPrice ? "up" : "down";
  const track = {
    id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
    targetPrice,
    direction,
    chatId: chatId === undefined ? undefined : String(chatId),
    createdAt: now,
    startPrice: currentPrice,
  };
  tracks.push(track);
  return track;
}

function crossesTrack(track, previousPrice, currentPrice) {
  if (!Number.isFinite(previousPrice)) {
    return track.direction === "up" ? currentPrice >= track.targetPrice : currentPrice <= track.targetPrice;
  }
  if (track.direction === "up") {
    return previousPrice < track.targetPrice && currentPrice >= track.targetPrice;
  }
  return previousPrice > track.targetPrice && currentPrice <= track.targetPrice;
}

function findTriggeredPriceTracks(tracks, { previousPrice, currentPrice }) {
  const triggered = [];
  const remaining = [];

  for (const track of tracks) {
    if (crossesTrack(track, previousPrice, currentPrice)) {
      triggered.push(track);
    } else {
      remaining.push(track);
    }
  }

  return { triggered, remaining };
}

function formatPriceTrackSetMessage(track, currentPrice, version) {
  const directionText = track.direction === "up" ? "above" : "below";
  return (
    `✅ *One-time PRL price alert set*\n\n` +
    `Target: *${formatPrice(track.targetPrice)}*\n` +
    `Current price: *${formatPrice(currentPrice)}*\n\n` +
    `I’ll alert once when PRL crosses ${directionText} *${formatPrice(track.targetPrice)}*.\n\n` +
    `_v${version}_`
  );
}

function formatPriceTrackTriggeredMessage(track, currentPrice, version) {
  const directionText = track.direction === "up" ? "above" : "below";
  const emoji = track.direction === "up" ? "📈" : "📉";
  return (
    `${emoji} *$PRL Price Track Hit*\n\n` +
    `PRL crossed ${directionText} *${formatPrice(track.targetPrice)}*\n` +
    `Current price: *${formatPrice(currentPrice)}*\n\n` +
    `_This was a one-time /track alert and has been removed._\n\n` +
    `_v${version}_`
  );
}

module.exports = {
  formatPrice,
  parseTrackCommand,
  addPriceTrack,
  findTriggeredPriceTracks,
  formatPriceTrackSetMessage,
  formatPriceTrackTriggeredMessage,
};
