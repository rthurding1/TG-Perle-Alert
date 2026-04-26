function formatCompact(value, prefix = "") {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "N/A";
  const n = Number(value);
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `${prefix}${(n / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${prefix}${(n / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${prefix}${(n / 1_000).toFixed(2)}K`;
  return `${prefix}${n.toFixed(2)}`;
}

function formatOpenInterest(oiRows) {
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
    lines.push(`${row.exchange}: ${formatCompact(row.notional, "$")} (${row.source})`);
  }

  return `*Open Interest*\n${lines.join("\n")}`;
}

module.exports = {
  formatCompact,
  formatOpenInterest,
};
