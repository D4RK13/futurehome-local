'use strict';

/**
 * Tuya datapoints ("DPs"), as Tuya devices send them in the payload of the
 * Tuya cluster (0xEF00). Learned from Zigbee2MQTT's `lib/tuya.ts` (MIT) and
 * the Tuya Zigbee app for Homey (MIT); written from scratch here.
 *
 * Payload after the 2-byte sequence number, repeated for each datapoint:
 *   dp (1 byte) | type (1 byte) | length (2 bytes, big-endian) | data
 * Numbers inside the data are big-endian.
 */

const TYPES = Object.freeze({
  raw: 0x00,
  bool: 0x01,
  value: 0x02, // signed 32-bit integer
  string: 0x03,
  enum: 0x04, // one byte
  bitmap: 0x05, // 1, 2 or 4 bytes
});

const TYPE_NAMES = Object.freeze(Object.fromEntries(Object.entries(TYPES).map(([name, id]) => [id, name])));

function decodeData(type, data) {
  switch (type) {
    case TYPES.bool:
      return data.length > 0 && data[0] !== 0;
    case TYPES.value:
      return data.length === 4 ? data.readInt32BE(0) : data.readIntBE(0, Math.min(data.length, 6));
    case TYPES.enum:
      return data[0];
    case TYPES.bitmap:
      return data.length > 0 ? data.readUIntBE(0, Math.min(data.length, 6)) : 0;
    case TYPES.string:
      return data.toString('utf8');
    default:
      return data.toString('hex');
  }
}

/**
 * Reads all datapoints in a payload. Stops at a cut-off record instead of
 * throwing, so one bad frame cannot stop the device.
 * @param {Buffer} payload - bytes after the sequence number
 * @returns {{dp: number, type: string, value: *}[]}
 */
function parseDatapoints(payload) {
  const datapoints = [];
  let offset = 0;
  while (offset + 4 <= payload.length) {
    const dp = payload[offset];
    const type = payload[offset + 1];
    const length = payload.readUInt16BE(offset + 2);
    const start = offset + 4;
    if (start + length > payload.length) break;
    const data = payload.subarray(start, start + length);
    datapoints.push({ dp, type: TYPE_NAMES[type] || `type${type}`, value: decodeData(type, data) });
    offset = start + length;
  }
  return datapoints;
}

/**
 * Builds one datapoint record for a "set datapoint" command.
 * @param {number} dp
 * @param {'bool'|'value'|'enum'} type
 * @param {boolean|number} value
 * @returns {Buffer}
 */
function encodeDatapoint(dp, type, value) {
  let data;
  if (type === 'bool') {
    data = Buffer.from([value ? 1 : 0]);
  } else if (type === 'value') {
    if (!Number.isInteger(value)) throw new Error(`Datapoint ${dp} needs a whole number, got ${value}`);
    data = Buffer.alloc(4);
    data.writeInt32BE(value, 0);
  } else if (type === 'enum') {
    if (!Number.isInteger(value) || value < 0 || value > 255) throw new Error(`Datapoint ${dp} needs 0–255, got ${value}`);
    data = Buffer.from([value]);
  } else {
    throw new Error(`Writing datapoint type "${type}" is not supported`);
  }
  const header = Buffer.from([dp, TYPES[type], 0, 0]);
  header.writeUInt16BE(data.length, 2);
  return Buffer.concat([header, data]);
}

/** Short text for a value we do not understand yet, for the diagnostics setting. */
function describeValue({ type, value }) {
  if (type === 'bool') return value ? 'true' : 'false';
  if (type === 'raw') return `0x${value}`;
  return String(value);
}

module.exports = {
  TYPES,
  parseDatapoints,
  encodeDatapoint,
  describeValue,
};
