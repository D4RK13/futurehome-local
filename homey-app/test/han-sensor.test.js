'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { installFakeHomey } = require('./fake-homey');

installFakeHomey();

const HanSensorDevice = require('../drivers/futurehome-han-sensor/device');
const { FakeZigbeeNode, HAN_ENDPOINTS } = require('./fake-zigbee-node');
const { NO_SUMMATION } = require('../lib/han-mapping');
const manifest = require('../drivers/futurehome-han-sensor/driver.compose.json');

const METERING = 1794;
const ELECTRICAL = 2820;

/** A three-phase house on a Kaifa or Aidon meter, values as the sensor sends them. */
function meterValues({ interfaceMode = 0x0202, imported = 12345678, exported = 0 } = {}) {
  return {
    2: {
      [ELECTRICAL]: {
        0x0304: 1500, 0x0305: -20, 0x0505: 2310, 0x0905: 2290, 0x0A05: 2300, 0x0508: 123, 0x0908: 45, 0x0A08: 67,
      },
      [METERING]: { 0x0000: imported, 0x0001: exported, 0x0302: interfaceMode },
    },
  };
}

async function createSensor({ attributes = meterValues(), endpoints = HAN_ENDPOINTS, language } = {}) {
  const node = new FakeZigbeeNode({ endpointDescriptors: endpoints, attributes });
  const device = new HanSensorDevice({ capabilities: manifest.capabilities, zigbeeNode: node, language, store: { zb_first_init: false } });
  await device.onInit();
  await device.nodeReady;
  await device.whenIdle();
  return { device, node };
}

const valuesOf = (device) => Object.fromEntries(manifest.capabilities.map((id) => [id, device.getCapabilityValue(id)]));

test('the first read fills power, energy, voltage and current per phase, and the meter type', async () => {
  const { device } = await createSensor();
  assert.deepEqual(valuesOf(device), {
    measure_power: 1500,
    'meter_power.imported': 12345.678,
    'meter_power.exported': 0,
    futurehome_reactive_power: -20,
    'measure_voltage.l1': 231,
    'measure_voltage.l2': 229,
    'measure_voltage.l3': 230,
    'measure_current.l1': 12.3,
    'measure_current.l2': 4.5,
    'measure_current.l3': 6.7,
  });
  assert.equal(device.getSetting('meter_type'), 'Aidon');
  assert.deepEqual(device.errors, []);
});

test('Kaifa and Kamstrup meters give the current in mA, so it is divided by 1000', async () => {
  const attributes = meterValues({ interfaceMode: 0x0203 });
  attributes[2][ELECTRICAL][0x0508] = 12300;
  const { device } = await createSensor({ attributes, language: 'no' });
  assert.equal(device.getCapabilityValue('measure_current.l1'), 12.3);
  assert.equal(device.getSetting('meter_type'), 'Kaifa og Kamstrup');
});

test('an energy total of 0 or all ones means "no reading yet" and is not shown', async () => {
  const { device } = await createSensor({ attributes: meterValues({ imported: NO_SUMMATION, exported: NO_SUMMATION }) });
  assert.equal(device.getCapabilityValue('meter_power.imported'), null);
  assert.equal(device.getCapabilityValue('meter_power.exported'), null);

  const zero = await createSensor({ attributes: meterValues({ imported: 0 }) });
  assert.equal(zero.device.getCapabilityValue('meter_power.imported'), null);
});

test('reports from the sensor update the values between reads', async () => {
  const { device, node } = await createSensor();
  await node.reportAttributes(2, ELECTRICAL, { 0x0304: 3200, 0x0505: 2335 });
  await node.reportAttributes(2, METERING, { 0x0000: 12346000 });
  await device.whenIdle();
  assert.equal(device.getCapabilityValue('measure_power'), 3200);
  assert.equal(device.getCapabilityValue('measure_voltage.l1'), 233.5);
  assert.equal(device.getCapabilityValue('meter_power.imported'), 12346);
});

test('Electrical Measurement is added by hand when the sensor does not announce it (as Zigbee2MQTT does)', async () => {
  const { device } = await createSensor({ endpoints: [{ endpointId: 2, inputClusters: [0, METERING], outputClusters: [] }] });
  assert.equal(device.getCapabilityValue('measure_power'), 1500);
  assert.ok(device.logs.some(([message]) => /not announced/.test(message)));
});

test('three failed reads in a row make the sensor unavailable, and the next good read brings it back', async () => {
  const { device, node } = await createSensor();
  node.offline = true;
  await device.poll();
  await device.poll();
  assert.equal(device.getAvailable(), true);
  await device.poll();
  assert.equal(device.getAvailable(), false);
  assert.match(device.unavailableMessage, /does not answer/);

  node.offline = false;
  await device.poll();
  assert.equal(device.getAvailable(), true);
});

test('a sensor without endpoint 2 is shown as unavailable with a reason', async () => {
  const { device } = await createSensor({ endpoints: [{ endpointId: 1, inputClusters: [0], outputClusters: [] }] });
  assert.equal(device.getAvailable(), false);
  assert.match(device.unavailableMessage, /endpoint 2/);
});

test('the HAN Sensor is never written to: only reads (and acknowledgements) leave the app', async () => {
  const { device, node } = await createSensor();
  await device.poll();
  await node.reportAttributes(2, ELECTRICAL, { 0x0304: 900 });
  await device.whenIdle();
  assert.ok(node.sent.length > 0);
  assert.deepEqual(node.writesSent(), []);
  // The manufacturer-specific meter type is read on its own, with Develco's code.
  const mfrRead = node.sent.find(({ frame }) => frame.frameControl.manufacturerSpecific);
  assert.equal(mfrRead.frame.manufacturerId, 0x1015);
});

test('the read timer is set to 30 s and stopped when the device is deleted', async () => {
  const { device } = await createSensor();
  assert.deepEqual(device.homey.timers.map(({ ms }) => ms), [30000]);
  device.onDeleted();
  assert.deepEqual(device.homey.timers, []);
});
