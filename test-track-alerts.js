const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseTrackCommand,
  addPriceTrack,
  findTriggeredPriceTracks,
  formatPriceTrackSetMessage,
} = require('./track-alerts');

test('parseTrackCommand accepts /track with a dollar price', () => {
  assert.deepEqual(parseTrackCommand('/track $0.25'), { ok: true, targetPrice: 0.25 });
});

test('parseTrackCommand rejects missing or invalid prices', () => {
  assert.equal(parseTrackCommand('/track').ok, false);
  assert.equal(parseTrackCommand('/track nope').ok, false);
  assert.equal(parseTrackCommand('/track -0.1').ok, false);
});

test('addPriceTrack sets direction based on current price', () => {
  const tracks = [];
  const up = addPriceTrack(tracks, { targetPrice: 0.25, currentPrice: 0.20, now: 1000 });
  const down = addPriceTrack(tracks, { targetPrice: 0.15, currentPrice: 0.20, now: 2000 });

  assert.equal(up.direction, 'up');
  assert.equal(down.direction, 'down');
  assert.equal(tracks.length, 2);
});

test('findTriggeredPriceTracks triggers once and removes crossed alerts', () => {
  const tracks = [];
  const up = addPriceTrack(tracks, { targetPrice: 0.25, currentPrice: 0.20, now: 1000 });
  const down = addPriceTrack(tracks, { targetPrice: 0.15, currentPrice: 0.20, now: 2000 });

  const first = findTriggeredPriceTracks(tracks, { previousPrice: 0.20, currentPrice: 0.26 });
  assert.deepEqual(first.triggered.map((track) => track.id), [up.id]);
  assert.deepEqual(first.remaining.map((track) => track.id), [down.id]);

  const second = findTriggeredPriceTracks(first.remaining, { previousPrice: 0.26, currentPrice: 0.14 });
  assert.deepEqual(second.triggered.map((track) => track.id), [down.id]);
  assert.deepEqual(second.remaining, []);
});

test('formatPriceTrackSetMessage explains one-time trigger', () => {
  const track = { targetPrice: 0.25, direction: 'up' };
  assert.match(formatPriceTrackSetMessage(track, 0.20, '1.0.1.0'), /one-time/i);
  assert.match(formatPriceTrackSetMessage(track, 0.20, '1.0.1.0'), /above \*\$0\.250000\*/);
});
