'use strict';

/**
 * Payload for answering a Tuya device's time request (command 0x24), as
 * Zigbee2MQTT does with `timeStart: "2000"` for this thermostat:
 *   size (uint16, little-endian: 8) | UTC seconds (uint32 BE) | local seconds (uint32 BE)
 * Seconds are counted from 2000-01-01 00:00 UTC.
 */

const JAN_1_2000_MS = Date.UTC(2000, 0, 1);

/** Minutes the time zone is ahead of UTC at that moment (Europe/Oslo: 60 or 120). */
function utcOffsetMinutes(nowMs, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(nowMs));
  const get = (type) => Number(parts.find((part) => part.type === type).value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asUtc - Math.floor(nowMs / 1000) * 1000) / 60000);
}

function timeSyncPayload(nowMs, timeZone) {
  const utcSeconds = Math.round((nowMs - JAN_1_2000_MS) / 1000);
  const localSeconds = utcSeconds + utcOffsetMinutes(nowMs, timeZone) * 60;
  const payload = Buffer.alloc(10);
  payload.writeUInt16LE(8, 0);
  payload.writeUInt32BE(utcSeconds, 2);
  payload.writeUInt32BE(localSeconds, 6);
  return payload;
}

module.exports = {
  timeSyncPayload,
  utcOffsetMinutes,
};
