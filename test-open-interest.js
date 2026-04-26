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

test('formatOpenInterest shows when a row came from cache', () => {
  const text = formatOpenInterest(
    [
      { exchange: 'Binance', notional: 2_000_000, source: 'CoinGecko', cachedAt: 1_700_000_000_000 },
      { exchange: 'Bybit', notional: 1_000_000, source: 'CoinGecko', cachedAt: 1_699_999_700_000 },
    ],
    { now: 1_700_000_000_000 }
  );

  assert.match(text, /Binance: \$2\.00M \(CoinGecko, cached <1m ago\)/);
  assert.match(text, /Bybit: \$1\.00M \(CoinGecko, cached 5m ago\)/);
});

test('mergeOpenInterestRowsWithCache falls back to cached rows and marks them cached', () => {
  const { mergeOpenInterestRowsWithCache } = require('./open-interest');
  const cache = new Map([
    ['Binance', { exchange: 'Binance', notional: 2_000_000, source: 'CoinGecko', updatedAt: 1_699_999_700_000 }],
  ]);

  const rows = mergeOpenInterestRowsWithCache({
    exchanges: ['Binance', 'Bybit'],
    freshRows: new Map(),
    cache,
    now: 1_700_000_000_000,
  });

  assert.deepEqual(rows, [
    {
      exchange: 'Binance',
      notional: 2_000_000,
      source: 'CoinGecko',
      updatedAt: 1_699_999_700_000,
      cachedAt: 1_699_999_700_000,
    },
    { exchange: 'Bybit', error: 'unavailable' },
  ]);
});

test('mergeOpenInterestRowsWithCache updates cache with fresh rows', () => {
  const { mergeOpenInterestRowsWithCache } = require('./open-interest');
  const cache = new Map();
  const freshRows = new Map([
    ['Binance', { exchange: 'Binance', notional: 2_500_000, source: 'CoinGecko' }],
  ]);

  const rows = mergeOpenInterestRowsWithCache({
    exchanges: ['Binance'],
    freshRows,
    cache,
    now: 1_700_000_000_000,
  });

  assert.equal(rows[0].cachedAt, undefined);
  assert.deepEqual(cache.get('Binance'), {
    exchange: 'Binance',
    notional: 2_500_000,
    source: 'CoinGecko',
    updatedAt: 1_700_000_000_000,
  });
});

test('hasFreshOpenInterestCache returns true only when every exchange is cached and fresh', () => {
  const { hasFreshOpenInterestCache } = require('./open-interest');
  const now = 1_700_000_000_000;
  const cache = new Map([
    ['Binance', { exchange: 'Binance', notional: 2_000_000, source: 'CoinGecko', updatedAt: now - 60_000 }],
    ['Bybit', { exchange: 'Bybit', notional: 1_000_000, source: 'CoinGecko', updatedAt: now - 9 * 60_000 }],
  ]);

  assert.equal(hasFreshOpenInterestCache({ exchanges: ['Binance', 'Bybit'], cache, maxAgeMs: 10 * 60_000, now }), true);
  assert.equal(hasFreshOpenInterestCache({ exchanges: ['Binance', 'Bybit'], cache, maxAgeMs: 5 * 60_000, now }), false);
  assert.equal(hasFreshOpenInterestCache({ exchanges: ['Binance', 'Bybit', 'Bitget'], cache, maxAgeMs: 10 * 60_000, now }), false);
});
