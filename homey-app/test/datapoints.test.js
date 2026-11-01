'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { parseDatapoints, encodeDatapoint, describeValue } = require('../lib/tuya/datapoints');
const { timeSyncPayload, utcOffsetMinutes } = require('../lib/tuya/time');

test('reads bool, value, enum, raw, string and bitmap datapoints from one payload', () => {
  const payload = Buffer.concat([
    encodeDatapoint(1, 'bool', true),
    encodeDatapoint(16, 'value', 22),
    encodeDatapoint(28, 'value', -3),
    encodeDatapoint(2, 'enum', 3),
    Buffer.from([105, 0x00, 0, 2, 0xAB, 0xCD]), // raw
    Buffer.from([200, 0x03, 0, 2, 0x68, 0x69]), // string "hi"
    Buffer.from([201, 0x05, 0, 2, 0x01, 0x02]), // bitmap
  ]);
  assert.deepEqual(parseDatapoints(payload), [
    { dp: 1, type: 'bool', value: true },
    { dp: 16, type: 'value', value: 22 },
    { dp: 28, type: 'value', value: -3 },
    { dp: 2, type: 'enum', value: 3 },
    { dp: 105, type: 'raw', value: 'abcd' },
    { dp: 200, type: 'string', value: 'hi' },
    { dp: 201, type: 'bitmap', value: 0x0102 },
  ]);
});

test('a cut-off datapoint at the end is dropped instead of breaking the rest', () => {
  const payload = Buffer.concat([encodeDatapoint(24, 'value', 21), Buffer.from([101, 0x02, 0, 4, 0x00])]);
  assert.deepEqual(parseDatapoints(payload), [{ dp: 24, type: 'value', value: 21 }]);
});

test('encodes datapoints with big-endian length and value', () => {
  assert.deepEqual(encodeDatapoint(16, 'value', 25), Buffer.from([16, 0x02, 0, 4, 0, 0, 0, 25]));
  assert.deepEqual(encodeDatapoint(1, 'bool', false), Buffer.from([1, 0x01, 0, 1, 0]));
  assert.deepEqual(encodeDatapoint(2, 'enum', 1), Buffer.from([2, 0x04, 0, 1, 1]));
});

test('refuses to encode values that do not fit the datapoint type', () => {
  assert.throws(() => encodeDatapoint(16, 'value', 21.5), /whole number/);
  assert.throws(() => encodeDatapoint(2, 'enum', 300), /0–255/);
  assert.throws(() => encodeDatapoint(105, 'raw', 'ab'), /not supported/);
});

test('unknown values are described as short text for the diagnostics setting', () => {
  assert.equal(describeValue({ type: 'value', value: 231 }), '231');
  assert.equal(describeValue({ type: 'bool', value: false }), 'false');
  assert.equal(describeValue({ type: 'raw', value: '0102' }), '0x0102');
});

test('the time answer counts from 2000 and adds Norway\'s offset (winter and summer time)', () => {
  const winter = Date.UTC(2026, 10, 1, 12, 0, 0);
  const summer = Date.UTC(2026, 6, 1, 12, 0, 0);
  assert.equal(utcOffsetMinutes(winter, 'Europe/Oslo'), 60);
  assert.equal(utcOffsetMinutes(summer, 'Europe/Oslo'), 120);

  const payload = timeSyncPayload(winter, 'Europe/Oslo');
  const utcSeconds = (winter - Date.UTC(2000, 0, 1)) / 1000;
  assert.equal(payload.length, 10);
  assert.equal(payload.readUInt16LE(0), 8);
  assert.equal(payload.readUInt32BE(2), utcSeconds);
  assert.equal(payload.readUInt32BE(6), utcSeconds + 3600);
});
