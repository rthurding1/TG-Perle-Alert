function formatCompact(value, prefix = "") {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "N/A";
  const n = Number(value);
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `${prefix}${(n / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${prefix}${(n / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${prefix}${(n / 1_000).toFixed(2)}K`;
  return `${prefix}${n.toFixed(2)}`;
}

function formatCacheAge(cachedAt, now = Date.now()) {
  const ageMs = Math.max(0, Number(now) - Number(cachedAt));
  const ageMinutes = Math.floor(ageMs / 60_000);
  if (ageMinutes < 1) return "<1m ago";
  if (ageMinutes < 60) return `${ageMinutes}m ago`;

  const ageHours = Math.floor(ageMinutes / 60);
  if (ageHours < 24) return `${ageHours}h ago`;

  const ageDays = Math.floor(ageHours / 24);
  return `${ageDays}d ago`;
}

function formatOpenInterest(oiRows, { now = Date.now() } = {}) {
  const total = oiRows.reduce((sum, row) => {
    const notional = Number(row?.notional);
    return Number.isFinite(notional) && !row.error ? sum + notional : sum;
  }, 0);

  const lines = [`Total: ${formatCompact(total, "$")}`];

  for (const row of oiRows) {
    if (row.error) {
      lines.push(`${row.exchange}: N/A`);
      continue;
    }

    const source = row.cachedAt
      ? `${row.source}, cached ${formatCacheAge(row.cachedAt, now)}`
      : row.source;
    lines.push(`${row.exchange}: ${formatCompact(row.notional, "$")} (${source})`);
  }

  return `*Open Interest*\n${lines.join("\n")}`;
}

function toTimestamp(value, fallback) {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;

  const parsed = Date.parse(value);
  if (Number.isFinite(parsed)) return parsed;

  return fallback;
}

function mergeOpenInterestRowsWithCache({ exchanges, freshRows, cache, now = Date.now() }) {
  return exchanges.map((exchange) => {
    const freshRow = freshRows.get(exchange);
    if (freshRow) {
      const cacheRow = { ...freshRow, updatedAt: toTimestamp(freshRow.updatedAt, now) };
      cache.set(exchange, cacheRow);
      return freshRow;
    }

    const cachedRow = cache.get(exchange);
    if (cachedRow) {
      return { ...cachedRow, cachedAt: toTimestamp(cachedRow.updatedAt, now) };
    }

    return { exchange, error: "unavailable" };
  });
}

function hasFreshOpenInterestCache({ exchanges, cache, maxAgeMs, now = Date.now() }) {
  return exchanges.every((exchange) => {
    const cachedRow = cache.get(exchange);
    if (!cachedRow) return false;

    const updatedAt = toTimestamp(cachedRow.updatedAt, NaN);
    return Number.isFinite(updatedAt) && now - updatedAt <= maxAgeMs;
  });
}

module.exports = {
  formatCompact,
  formatOpenInterest,
  mergeOpenInterestRowsWithCache,
  hasFreshOpenInterestCache,
};
