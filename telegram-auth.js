function parseAllowedTelegramIds(primaryChatId, extraAllowedIds = "") {
  const ids = new Set();
  for (const value of [primaryChatId, ...String(extraAllowedIds || "").split(/[\s,]+/)]) {
    const id = String(value || "").trim();
    if (id) ids.add(id);
  }
  return ids;
}

function isAuthorizedTelegramMessage(msg, allowedIds) {
  const chatId = msg?.chat?.id === undefined ? "" : String(msg.chat.id);
  const fromId = msg?.from?.id === undefined ? "" : String(msg.from.id);
  return allowedIds.has(chatId) || allowedIds.has(fromId);
}

module.exports = {
  parseAllowedTelegramIds,
  isAuthorizedTelegramMessage,
};
