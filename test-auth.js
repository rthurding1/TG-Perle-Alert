const test = require('node:test');
const assert = require('node:assert/strict');

const { parseAllowedTelegramIds, isAuthorizedTelegramMessage } = require('./telegram-auth');

test('parseAllowedTelegramIds includes primary chat and extra whitelist ids', () => {
  assert.deepEqual(parseAllowedTelegramIds('5801106796', '8626366848, 123'), new Set(['5801106796', '8626366848', '123']));
});

test('isAuthorizedTelegramMessage allows a whitelisted user in a direct chat', () => {
  const allowed = new Set(['5801106796', '8626366848']);
  const msg = { chat: { id: 8626366848 }, from: { id: 8626366848 } };
  assert.equal(isAuthorizedTelegramMessage(msg, allowed), true);
});

test('isAuthorizedTelegramMessage rejects non-whitelisted users', () => {
  const allowed = new Set(['5801106796', '8626366848']);
  const msg = { chat: { id: 999 }, from: { id: 999 } };
  assert.equal(isAuthorizedTelegramMessage(msg, allowed), false);
});
