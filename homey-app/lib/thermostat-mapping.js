'use strict';

/**
 * Futurehome Smart Thermostat PR (Co020, Tuya TS0601): datapoint table.
 * Datapoints from Zigbee2MQTT's `TS0601_futurehome_thermostat` (MIT). One row
 * per datapoint; adding a feature is adding a row (see lib/mapping.js).
 *
 * Row fields:
 *   dp          Tuya datapoint number
 *   id          Homey capability or setting id
 *   kind        'capability' | 'setting' | 'label' (read-only text setting)
 *   type        Tuya type for writing: 'bool' | 'value' | 'enum'
 *   fromDevice  (raw) => Homey value; undefined means "ignore this report"
 *   toDevice    (Homey value) => raw. Rows without it can never be written.
 *   label       (raw, __) => text, for 'label' rows
 */

const MODES = ['heat', 'home', 'away', 'auto']; // DP 2 (Z2M: user, home, away, auto)
const SENSOR_TYPES = ['room', 'floor', 'max_guard']; // DP 102

const indexOf = (list, name) => {
  const index = list.indexOf(name);
  if (index < 0) throw new Error(`Unknown value "${name}"`);
  return index;
};

const wholeNumber = (min, max) => (value) => {
  const rounded = Math.round(Number(value));
  if (!Number.isFinite(rounded) || rounded < min || rounded > max) {
    throw new Error(`Must be between ${min} and ${max}, got ${value}`);
  }
  return rounded;
};

const same = (value) => value;

const THERMOSTAT_DATAPOINTS = Object.freeze([
  // Capabilities, in the order of the driver manifest.
  { dp: 1, id: 'onoff', kind: 'capability', type: 'bool', fromDevice: Boolean, toDevice: Boolean },
  { dp: 16, id: 'target_temperature', kind: 'capability', type: 'value', fromDevice: same, toDevice: wholeNumber(5, 35) },
  { dp: 24, id: 'measure_temperature', kind: 'capability', fromDevice: same },
  { dp: 101, id: 'measure_temperature.floor', kind: 'capability', fromDevice: same },
  { dp: 104, id: 'futurehome_heating', kind: 'capability', fromDevice: Boolean },
  // A counter in 0.01 kWh; the device keeps it from going down (see device.js).
  { dp: 123, id: 'meter_power', kind: 'capability', fromDevice: (raw) => raw / 100 },
  {
    dp: 2,
    id: 'futurehome_thermostat_mode',
    kind: 'capability',
    type: 'enum',
    fromDevice: (raw) => MODES[raw],
    toDevice: (mode) => indexOf(MODES, mode),
  },
  { dp: 30, id: 'futurehome_child_lock', kind: 'capability', type: 'bool', fromDevice: Boolean, toDevice: Boolean },

  // Settings, in the order of driver.settings.compose.json.
  { dp: 106, id: 'open_window_detection', kind: 'setting', type: 'bool', fromDevice: Boolean, toDevice: Boolean },
  { dp: 103, id: 'hysteresis', kind: 'setting', type: 'value', fromDevice: same, toDevice: wholeNumber(1, 9) },
  { dp: 28, id: 'temperature_calibration', kind: 'setting', type: 'value', fromDevice: same, toDevice: wholeNumber(-9, 9) },
  // Safety: the sensor type and the floor limit protect the floor. Shown, never written.
  {
    dp: 102,
    id: 'sensor_type',
    kind: 'label',
    label: (raw, __) => (SENSOR_TYPES[raw] ? __(`thermostat.sensor_type.${SENSOR_TYPES[raw]}`) : `${__('unknown')} (${raw})`),
  },
  { dp: 107, id: 'max_guard_temperature', kind: 'label', label: (raw) => String(raw) },
]);

/** Datapoints Zigbee2MQTT has seen but nobody has decoded yet; logged in the diagnostics setting. */
const KNOWN_UNKNOWN_DATAPOINTS = Object.freeze([105, 120, 121, 122]);

module.exports = {
  MODES,
  SENSOR_TYPES,
  THERMOSTAT_DATAPOINTS,
  KNOWN_UNKNOWN_DATAPOINTS,
};
