'use strict';

/**
 * Which writes to the devices Sondre has approved (safety rules: default is
 * read-only, and each kind of write needs his approval first).
 *
 * Until an id is listed here, a change in Homey (app, Flow or settings) is
 * refused with a clear message, and nothing is sent to the device. To approve
 * one, add it with the date, e.g. `target_temperature: '2026-11-05'`.
 *
 * Ids are capability or setting ids from the mapping tables, plus:
 *   time_sync - answer the thermostat's request for the time (sets its clock)
 *
 * Never listed, because they have no write path at all: the thermostat's
 * sensor type and floor limit (max guard), and the HAN Sensor's meter type.
 */
const APPROVED_WRITES = Object.freeze({
  // Sondre approved all eight on 2026-11-02, after the read test on thermostat A.
  thermostat: Object.freeze({
    target_temperature: '2026-11-02',
    onoff: '2026-11-02',
    futurehome_thermostat_mode: '2026-11-02',
    futurehome_child_lock: '2026-11-02',
    open_window_detection: '2026-11-02',
    hysteresis: '2026-11-02',
    temperature_calibration: '2026-11-02',
    time_sync: '2026-11-02',
  }),
  han: Object.freeze({}),
});

class WriteNotApprovedError extends Error {

  constructor(deviceKind, id) {
    super(`Writing "${id}" to the ${deviceKind} is not approved yet`);
    this.name = 'WriteNotApprovedError';
    this.deviceKind = deviceKind;
    this.id = id;
  }

}

/**
 * @param {string} deviceKind - key in APPROVED_WRITES
 * @param {string} id - capability, setting or special id
 * @param {object} [approved] - for tests only
 */
function isWriteApproved(deviceKind, id, approved = APPROVED_WRITES) {
  const forDevice = approved[deviceKind] || {};
  return typeof forDevice[id] === 'string' && forDevice[id].length > 0;
}

module.exports = {
  APPROVED_WRITES,
  WriteNotApprovedError,
  isWriteApproved,
};
