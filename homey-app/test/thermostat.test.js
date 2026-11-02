'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { installFakeHomey } = require('./fake-homey');

installFakeHomey();

const ThermostatDevice = require('../drivers/futurehome-thermostat/device');
const ThermostatDriver = require('../drivers/futurehome-thermostat/driver');
const { FakeZigbeeNode, THERMOSTAT_ENDPOINTS } = require('./fake-zigbee-node');
const { parseDatapoints } = require('../lib/tuya/datapoints');
const manifest = require('../drivers/futurehome-thermostat/driver.compose.json');

const BASIC = { 4: '_TZE200_e5hpkc6d', 5: 'TS0601', 0: 3, 1: 65, 7: 1 };

/** Everything the thermostat reported in one go, as a real one does after a query. */
const FULL_REPORT = [
  { dp: 1, type: 'bool', value: true },
  { dp: 2, type: 'enum', value: 0 },
  { dp: 16, type: 'value', value: 22 },
  { dp: 24, type: 'value', value: 21 },
  { dp: 28, type: 'value', value: -1 },
  { dp: 30, type: 'bool', value: false },
  { dp: 101, type: 'value', value: 24 },
  { dp: 102, type: 'enum', value: 2 },
  { dp: 103, type: 'value', value: 2 },
  { dp: 104, type: 'bool', value: true },
  { dp: 106, type: 'bool', value: true },
  { dp: 107, type: 'value', value: 27 },
  { dp: 123, type: 'value', value: 1234 },
];

async function createThermostat({
  firstInit = false, approvedWrites, language, endpoints = THERMOSTAT_ENDPOINTS, store = {},
} = {}) {
  const node = new FakeZigbeeNode({ endpointDescriptors: endpoints, attributes: { 1: { 0: BASIC } } });
  const device = new ThermostatDevice({
    capabilities: manifest.capabilities,
    zigbeeNode: node,
    language,
    store: firstInit ? store : { zb_first_init: false, ...store },
  });
  if (approvedWrites) device._approvedWrites = approvedWrites;
  await device.onInit();
  await device.nodeReady;
  return { device, node };
}

async function report(device, node, datapoints) {
  await node.reportDatapoints(datapoints);
  await device.whenIdle();
}

test('a report fills every capability and setting the thermostat has', async () => {
  const { device, node } = await createThermostat();
  await report(device, node, FULL_REPORT);

  assert.deepEqual(
    Object.fromEntries(manifest.capabilities.map((id) => [id, device.getCapabilityValue(id)])),
    {
      onoff: true,
      target_temperature: 22,
      measure_temperature: 21,
      'measure_temperature.floor': 24,
      futurehome_heating: true,
      meter_power: 12.34,
      futurehome_thermostat_mode: 'heat',
      futurehome_child_lock: false,
    },
  );
  assert.deepEqual(device.getSettings(), {
    temperature_calibration: -1,
    sensor_type: 'Max guard (room sensor with floor limit)',
    hysteresis: 2,
    open_window_detection: true,
    max_guard_temperature: '27',
  });
  assert.deepEqual(device.errors, []);
});

test('the sensor type is shown in Norwegian on a Norwegian Homey', async () => {
  const { device, node } = await createThermostat({ language: 'no' });
  await report(device, node, [{ dp: 102, type: 'enum', value: 1 }]);
  assert.equal(device.getSetting('sensor_type'), 'Gulvføler');
});

test('the energy counter never goes down, except a reset to 0', async () => {
  const { device, node } = await createThermostat();
  await report(device, node, [{ dp: 123, type: 'value', value: 500 }]);
  await report(device, node, [{ dp: 123, type: 'value', value: 400 }]);
  assert.equal(device.getCapabilityValue('meter_power'), 5);
  await report(device, node, [{ dp: 123, type: 'value', value: 510 }]);
  assert.equal(device.getCapabilityValue('meter_power'), 5.1);
  await report(device, node, [{ dp: 123, type: 'value', value: 0 }]);
  assert.equal(device.getCapabilityValue('meter_power'), 0);
});

test('values the app does not know go to the diagnostics setting and are kept over a restart', async () => {
  const { device, node } = await createThermostat();
  await report(device, node, [
    { dp: 121, type: 'value', value: 231 },
    { dp: 105, type: 'raw', hex: '0102' },
    { dp: 120, type: 'value', value: 3 },
  ]);
  assert.equal(device.getSetting('unknown_datapoints'), '105: 0x0102 · 120: 3 · 121: 231');

  const restarted = await createThermostat({ store: { unknownDatapoints: device.getStoreValue('unknownDatapoints') } });
  await report(restarted.device, restarted.node, [{ dp: 122, type: 'value', value: 1800 }]);
  assert.equal(restarted.device.getSetting('unknown_datapoints'), '105: 0x0102 · 120: 3 · 121: 231 · 122: 1800');
});

test('a mode number the app does not know is left alone', async () => {
  const { device, node } = await createThermostat();
  await report(device, node, [{ dp: 2, type: 'enum', value: 1 }]);
  await report(device, node, [{ dp: 2, type: 'enum', value: 9 }]);
  assert.equal(device.getCapabilityValue('futurehome_thermostat_mode'), 'home');
});

test('Flow triggers fire on real changes only, not on the first value', async () => {
  const { device, node } = await createThermostat();
  const cards = device.homey.cards;
  await report(device, node, FULL_REPORT);
  assert.equal(cards['trigger:thermostat_mode_changed'], undefined);

  await report(device, node, [
    { dp: 2, type: 'enum', value: 2 },
    { dp: 104, type: 'bool', value: false },
    { dp: 30, type: 'bool', value: true },
  ]);
  await report(device, node, [{ dp: 104, type: 'bool', value: true }]);

  assert.deepEqual(cards['trigger:thermostat_mode_changed'].triggered.map(({ tokens, state }) => [tokens, state]), [[{ mode: 'away' }, { value: 'away' }]]);
  assert.equal(cards['trigger:heating_stopped'].triggered.length, 1);
  assert.equal(cards['trigger:heating_started'].triggered.length, 1);
  assert.deepEqual(cards['trigger:child_lock_changed'].triggered.map(({ state }) => state), [{ value: 'on' }]);
});

test('first start reads the basic info and asks for all datapoints, which are reads only', async () => {
  const { device, node } = await createThermostat({ firstInit: true });
  assert.ok(device.logs.some(([message, info]) => message === 'Basic info:' && info.manufacturerName === '_TZE200_e5hpkc6d'));
  const kinds = node.sent.map(({ clusterId, frame }) => [clusterId, frame.frameControl.clusterSpecific, frame.cmdId]);
  assert.deepEqual(kinds, [[0, false, 0x00], [0xEF00, true, 0x03]]);
  assert.deepEqual(node.writesSent(), []);
});

test('a later start only asks for the datapoints', async () => {
  const { node } = await createThermostat();
  assert.deepEqual(node.sent.map(({ clusterId, frame }) => [clusterId, frame.cmdId]), [[0xEF00, 0x03]]);
});

test('a thermostat without the Tuya cluster is shown as unavailable with a reason', async () => {
  const { device } = await createThermostat({ endpoints: [{ endpointId: 1, inputClusters: [0], outputClusters: [] }] });
  assert.equal(device.getAvailable(), false);
  assert.match(device.unavailableMessage, /Tuya cluster/);
});

// Safety: nothing may change the thermostat until Sondre approves that kind of write.

test('without approval, a change in the Homey app is refused and nothing is sent', async () => {
  const { device, node } = await createThermostat();
  await report(device, node, FULL_REPORT);
  node.sent = [];
  for (const [id, value] of [['onoff', false], ['target_temperature', 25], ['futurehome_thermostat_mode', 'away'], ['futurehome_child_lock', true]]) {
    await assert.rejects(device.triggerCapability(id, value), { name: 'WriteNotApprovedError', message: /not turned on yet/ }, id);
  }
  assert.equal(device.getCapabilityValue('target_temperature'), 22);
  assert.deepEqual(node.sent, []);
});

test('without approval, changed settings are refused and stay as they were', async () => {
  const { device, node } = await createThermostat();
  await report(device, node, FULL_REPORT);
  node.sent = [];
  await assert.rejects(device.changeSettings({ hysteresis: 4 }), { name: 'WriteNotApprovedError' });
  assert.equal(device.getSetting('hysteresis'), 2);
  assert.deepEqual(node.sent, []);
});

test('without approval, the time request is not answered', async () => {
  const { device, node } = await createThermostat();
  node.sent = [];
  await node.requestTime();
  await device.whenIdle();
  assert.deepEqual(node.writesSent(), []);
  assert.ok(device.logs.some(([message]) => /not answered/.test(message)));
});

test('an approved write sends exactly that datapoint, and other writes stay refused', async () => {
  const { device, node } = await createThermostat({ approvedWrites: { thermostat: { target_temperature: '2026-11-01' } } });
  node.sent = [];
  await device.triggerCapability('target_temperature', 25);
  await assert.rejects(device.triggerCapability('onoff', false), { name: 'WriteNotApprovedError' });

  const writes = node.tuyaWrites();
  assert.equal(writes.length, 1);
  assert.equal(writes[0].frame.data.readUInt16LE(0) > 0, true);
  assert.deepEqual(parseDatapoints(writes[0].frame.data.subarray(2)), [{ dp: 16, type: 'value', value: 25 }]);
  // Same frame as Zigbee2MQTT sends: cluster specific, to the device, no default response wanted.
  const { frameControl } = writes[0].frame;
  assert.equal(frameControl.clusterSpecific, true);
  assert.equal(frameControl.directionToClient, false);
  assert.equal(frameControl.disableDefaultResponse, true);
});

test('an approved target temperature outside 5–35 °C is refused before sending', async () => {
  const { device, node } = await createThermostat({ approvedWrites: { thermostat: { target_temperature: '2026-11-01' } } });
  node.sent = [];
  await assert.rejects(device.triggerCapability('target_temperature', 40), /between 5 and 35/);
  assert.deepEqual(node.tuyaWrites(), []);
});

test('settings are all-or-nothing: one unapproved setting stops the whole save', async () => {
  const { device, node } = await createThermostat({ approvedWrites: { thermostat: { hysteresis: '2026-11-01' } } });
  node.sent = [];
  await assert.rejects(device.changeSettings({ hysteresis: 3, temperature_calibration: 2 }), { name: 'WriteNotApprovedError' });
  assert.deepEqual(node.tuyaWrites(), []);

  await device.changeSettings({ hysteresis: 3 });
  assert.deepEqual(parseDatapoints(node.tuyaWrites()[0].frame.data.subarray(2)), [{ dp: 103, type: 'value', value: 3 }]);
});

test('an approved time sync answers with the time counted from 2000', async () => {
  const { device, node } = await createThermostat({ approvedWrites: { thermostat: { time_sync: '2026-11-01' } } });
  node.sent = [];
  await node.requestTime();
  await device.whenIdle();
  const answer = node.writesSent().find(({ frame }) => frame.cmdId === 0x24);
  assert.ok(answer, 'time answer sent');
  assert.equal(answer.frame.data.length, 10);
});

test('Flow cards: conditions read the device, actions go through the same approval', async () => {
  const driver = new ThermostatDriver();
  await driver.onInit();
  const { device, node } = await createThermostat();
  await report(device, node, FULL_REPORT);
  const card = (kind, id) => driver.homey.cards[`${kind}:${id}`];

  assert.equal(await card('condition', 'thermostat_mode_is').runListener({ device, mode: 'heat' }), true);
  assert.equal(await card('condition', 'is_heating').runListener({ device }), true);
  assert.equal(await card('condition', 'child_lock_is_on').runListener({ device }), false);
  assert.equal(await card('trigger', 'thermostat_mode_changed').runListener({ mode: 'away' }, { value: 'away' }), true);
  assert.equal(await card('trigger', 'child_lock_changed').runListener({ state: 'on' }, { value: 'off' }), false);

  node.sent = [];
  await assert.rejects(card('action', 'set_thermostat_mode').runListener({ device, mode: 'away' }), { name: 'WriteNotApprovedError' });
  await assert.rejects(card('action', 'set_child_lock').runListener({ device, state: 'on' }), { name: 'WriteNotApprovedError' });
  await assert.rejects(card('action', 'set_open_window_detection').runListener({ device, state: 'off' }), { name: 'WriteNotApprovedError' });
  assert.deepEqual(node.sent, []);
  assert.equal(device.getSetting('open_window_detection'), true);
});
