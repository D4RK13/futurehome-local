'use strict';

/**
 * Futurehome HAN Sensor (GH201E, made by Develco): attribute table.
 * Clusters and scaling from Zigbee2MQTT's Develco EMIZB-132 definition (MIT)
 * and ZHA's `develco/emi_han.py`. All rows are read-only.
 *
 * Row fields:
 *   cluster     zigbee-clusters cluster name on endpoint HAN_ENDPOINT
 *   attribute   attribute name in that cluster
 *   id          Homey capability or setting id
 *   kind        'capability' | 'label'
 *   fromDevice  (raw, context) => Homey value; undefined means "no value"
 *   label       (raw, __) => text, for 'label' rows
 */

/** Endpoint with Metering and Electrical Measurement (Z2M and ZHA). Unverified on Sondre's sensor. */
const HAN_ENDPOINT = 2;

/** Develco interface modes (Z2M `interface_mode`). The current divisor depends on it. */
const INTERFACE_MODES = Object.freeze({
  0x0200: { name: 'norwegian_han', currentDivisor: 10 },
  0x0201: { name: 'norwegian_han_extra_load', currentDivisor: 10 },
  0x0202: { name: 'aidon', currentDivisor: 10 },
  0x0203: { name: 'kaifa_kamstrup', currentDivisor: 1000 },
});

const DEFAULT_CURRENT_DIVISOR = 10;

/** 0 and all ones mean "no reading yet" for energy totals (Z2M). */
const NO_SUMMATION = 0xFFFFFFFFFFFF;

const energy = (raw) => (raw === 0 || raw === NO_SUMMATION || !Number.isFinite(raw) ? undefined : raw / 1000);
const volts = (raw) => raw / 10;
const amps = (raw, context) => raw / context.currentDivisor;
const same = (raw) => raw;

const HAN_ATTRIBUTES = Object.freeze([
  // Capabilities, in the order of the driver manifest.
  { cluster: 'electricalMeasurement', attribute: 'totalActivePower', id: 'measure_power', kind: 'capability', fromDevice: same },
  { cluster: 'metering', attribute: 'currentSummationDelivered', id: 'meter_power.imported', kind: 'capability', fromDevice: energy },
  { cluster: 'metering', attribute: 'currentSummationReceived', id: 'meter_power.exported', kind: 'capability', fromDevice: (raw) => (raw === NO_SUMMATION ? undefined : raw / 1000) },
  { cluster: 'electricalMeasurement', attribute: 'totalReactivePower', id: 'futurehome_reactive_power', kind: 'capability', fromDevice: same },
  { cluster: 'electricalMeasurement', attribute: 'rmsVoltage', id: 'measure_voltage.l1', kind: 'capability', fromDevice: volts },
  { cluster: 'electricalMeasurement', attribute: 'rmsVoltagePhB', id: 'measure_voltage.l2', kind: 'capability', fromDevice: volts },
  { cluster: 'electricalMeasurement', attribute: 'rmsVoltagePhC', id: 'measure_voltage.l3', kind: 'capability', fromDevice: volts },
  { cluster: 'electricalMeasurement', attribute: 'rmsCurrent', id: 'measure_current.l1', kind: 'capability', fromDevice: amps },
  { cluster: 'electricalMeasurement', attribute: 'rmsCurrentPhB', id: 'measure_current.l2', kind: 'capability', fromDevice: amps },
  { cluster: 'electricalMeasurement', attribute: 'rmsCurrentPhC', id: 'measure_current.l3', kind: 'capability', fromDevice: amps },

  // Settings (read-only text).
  {
    cluster: 'metering',
    attribute: 'develcoInterfaceMode',
    id: 'meter_type',
    kind: 'label',
    label: (raw, __) => (INTERFACE_MODES[raw] ? __(`han.meter_type.${INTERFACE_MODES[raw].name}`) : `${__('unknown')} (0x${Number(raw).toString(16)})`),
  },
]);

/** Attributes to read in one request per cluster (the manufacturer-specific one goes alone). */
function attributesToPoll(cluster) {
  return HAN_ATTRIBUTES
    .filter((row) => row.cluster === cluster && row.attribute !== 'develcoInterfaceMode')
    .map((row) => row.attribute);
}

function currentDivisorFor(interfaceMode) {
  return (INTERFACE_MODES[interfaceMode] || {}).currentDivisor || DEFAULT_CURRENT_DIVISOR;
}

module.exports = {
  HAN_ENDPOINT,
  HAN_ATTRIBUTES,
  INTERFACE_MODES,
  NO_SUMMATION,
  attributesToPoll,
  currentDivisorFor,
};
