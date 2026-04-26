const test = require('node:test');
const assert = require('node:assert/strict');

const { formatOpenInterest } = require('./open-interest');

test('formatOpenInterest shows total OI first and formats Bitget like Binance and Bybit', () => {
  const text = formatOpenInterest([
    { exchange: 'Binance', notional: 2_910_000, source: 'CoinGecko' },
    { exchange: 'Bybit', notional: 1_290_000, source: 'CoinGecko' },
    { exchange: 'Bitget', amount: 7_000_000, notional: 1_510_000, source: 'Bitget' },
  ]);

  assert.equal(
    text,
    '*Open Interest*\nTotal: $5.71M\nBinance: $2.91M (CoinGecko)\nBybit: $1.29M (CoinGecko)\nBitget: $1.51M (Bitget)'
  );
});

test('formatOpenInterest total excludes unavailable exchanges', () => {
  const text = formatOpenInterest([
    { exchange: 'Binance', notional: 2_000_000, source: 'CoinGecko' },
    { exchange: 'Bybit', error: 'unavailable' },
    { exchange: 'Bitget', notional: 1_000_000, source: 'Bitget' },
  ]);

  assert.match(text, /Total: \$3\.00M/);
  assert.match(text, /Bybit: N\/A/);
});
