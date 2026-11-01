'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { installFakeHomey, translate } = require('./fake-homey');

installFakeHomey();

const { THERMOSTAT_DATAPOINTS, MODES, SENSOR_TYPES } = require('../lib/thermostat-mapping');
const { HAN_ATTRIBUTES, INTERFACE_MODES } = require('../lib/han-mapping');
const { APPROVED_WRITES } = require('../lib/control');
const ThermostatDriver = require('../drivers/futurehome-thermostat/driver');

const APP_DIR = path.join(__dirname, '..');
const DRIVERS = ['futurehome-thermostat', 'futurehome-han-sensor'];
const LANGUAGES = ['en', 'no'];

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(APP_DIR, relativePath), 'utf8'));
}

function settingIds(settings) {
  return settings.flatMap((setting) => (setting.type === 'group' ? settingIds(setting.children) : [setting.id]));
}

function allSettings(settings) {
  return settings.flatMap((setting) => (setting.type === 'group' ? allSettings(setting.children) : [setting]));
}

test('driver manifests list exactly the capabilities in the mapping tables, in order', () => {
  const capabilityIds = (rows) => rows.filter((row) => row.kind === 'capability').map((row) => row.id);
  assert.deepEqual(readJson('drivers/futurehome-thermostat/driver.compose.json').capabilities, capabilityIds(THERMOSTAT_DATAPOINTS));
  assert.deepEqual(readJson('drivers/futurehome-han-sensor/driver.compose.json').capabilities, capabilityIds(HAN_ATTRIBUTES));
});

test('settings in the manifests match the mapping tables, plus the diagnostics field', () => {
  const settingRows = (rows) => rows.filter((row) => row.kind !== 'capability').map((row) => row.id).sort();
  assert.deepEqual(
    settingIds(readJson('drivers/futurehome-thermostat/driver.settings.compose.json')).sort(),
    [...settingRows(THERMOSTAT_DATAPOINTS), 'unknown_datapoints'].sort(),
  );
  assert.deepEqual(settingIds(readJson('drivers/futurehome-han-sensor/driver.settings.compose.json')).sort(), settingRows(HAN_ATTRIBUTES));
});

test('read-only rows are text fields in the settings, so Homey offers no way to change them', () => {
  for (const [driverId, rows] of [['futurehome-thermostat', THERMOSTAT_DATAPOINTS], ['futurehome-han-sensor', HAN_ATTRIBUTES]]) {
    const settings = allSettings(readJson(`drivers/${driverId}/driver.settings.compose.json`));
    for (const row of rows.filter((candidate) => candidate.kind === 'label')) {
      assert.equal(settings.find((setting) => setting.id === row.id).type, 'label', `${driverId}: ${row.id}`);
    }
  }
});

test('safety: the floor protection and the meter type have no write path at all', () => {
  for (const id of ['sensor_type', 'max_guard_temperature']) {
    const row = THERMOSTAT_DATAPOINTS.find((candidate) => candidate.id === id);
    assert.equal(row.kind, 'label', id);
    assert.equal(row.toDevice, undefined, id);
  }
  assert.ok(HAN_ATTRIBUTES.every((row) => row.toDevice === undefined), 'HAN Sensor rows are read-only');
});

test('safety: approved writes have a date and never include the protected values', () => {
  const forbidden = ['sensor_type', 'max_guard_temperature', 'meter_type'];
  for (const [deviceKind, approvals] of Object.entries(APPROVED_WRITES)) {
    for (const [id, date] of Object.entries(approvals)) {
      assert.match(date, /^\d{4}-\d{2}-\d{2}$/, `${deviceKind}.${id}`);
      assert.equal(forbidden.includes(id), false, `${deviceKind}.${id} must never be approved`);
    }
  }
});

test('Zigbee drivers use Homey\'s own pairing: no custom views, no bind requests', () => {
  for (const driverId of DRIVERS) {
    const driver = readJson(`drivers/${driverId}/driver.compose.json`);
    assert.equal(driver.pair, undefined, driverId);
    for (const endpoint of Object.values(driver.zigbee.endpoints)) {
      assert.deepEqual(endpoint.bindings, [], driverId);
    }
  }
});

test('the thermostat driver matches the IDs read from Sondre\'s thermostat', () => {
  const { zigbee } = readJson('drivers/futurehome-thermostat/driver.compose.json');
  assert.ok(zigbee.manufacturerName.includes('_TZE200_e5hpkc6d'));
  assert.deepEqual(zigbee.productId, ['TS0601']);
  assert.deepEqual(zigbee.endpoints['1'].clusters, [0, 4, 5, 61184]);
});

test('every driver has a pairing guide with a picture and numbered steps in English and Norwegian', () => {
  for (const driverId of DRIVERS) {
    const { learnmode } = readJson(`drivers/${driverId}/driver.compose.json`).zigbee;
    assert.ok(fs.existsSync(path.join(APP_DIR, learnmode.image)), `${driverId}: ${learnmode.image}`);
    for (const language of LANGUAGES) {
      assert.match(learnmode.instruction[language], /^1\. .+\n2\. .+\n3\. /, `${driverId} (${language})`);
    }
  }
});

test('driver names are the product names in Title Case, the same in both languages where possible', () => {
  const titleCase = (name) => name.split(' ').every((word) => /^[A-ZÆØÅ]/.test(word));
  for (const driverId of DRIVERS) {
    const { name } = readJson(`drivers/${driverId}/driver.compose.json`);
    for (const language of LANGUAGES) {
      assert.ok(name[language].startsWith('Futurehome '), `${driverId} (${language})`);
      assert.ok(titleCase(name[language]), `${driverId} (${language}): ${name[language]}`);
    }
  }
});

test('every capability, setting and Flow card has English and Norwegian text', () => {
  const hasBoth = (text, where) => LANGUAGES.forEach((language) => assert.equal(typeof text?.[language], 'string', `${where} (${language})`));
  for (const file of fs.readdirSync(path.join(APP_DIR, '.homeycompose/capabilities'))) {
    const capability = readJson(`.homeycompose/capabilities/${file}`);
    hasBoth(capability.title, file);
    for (const value of capability.values || []) hasBoth(value.title, `${file} ${value.id}`);
  }
  for (const driverId of DRIVERS) {
    const driver = readJson(`drivers/${driverId}/driver.compose.json`);
    for (const [id, options] of Object.entries(driver.capabilitiesOptions || {})) {
      if (options.title) hasBoth(options.title, `${driverId} ${id}`);
    }
    for (const setting of allSettings(readJson(`drivers/${driverId}/driver.settings.compose.json`))) {
      hasBoth(setting.label, `${driverId} ${setting.id}`);
      hasBoth(setting.hint, `${driverId} ${setting.id} hint`);
    }
  }
  const flow = readJson('drivers/futurehome-thermostat/driver.flow.compose.json');
  for (const card of [...flow.triggers, ...flow.conditions, ...flow.actions]) {
    hasBoth(card.title, card.id);
    if (card.titleFormatted) hasBoth(card.titleFormatted, `${card.id} titleFormatted`);
  }
});

test('number settings have their unit in the name, as in mill-local', () => {
  for (const setting of allSettings(readJson('drivers/futurehome-thermostat/driver.settings.compose.json'))) {
    if (setting.type !== 'number') continue;
    for (const language of LANGUAGES) assert.match(setting.label[language], /\(°C\)$/, `${setting.id} (${language})`);
  }
});

test('every text key the code uses exists in English and Norwegian', () => {
  const keys = new Set(['unknown']);
  const sources = ['lib', 'drivers'].flatMap((dir) => fs.readdirSync(path.join(APP_DIR, dir), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
    .map((entry) => fs.readFileSync(path.join(entry.parentPath, entry.name), 'utf8')));
  for (const source of sources) {
    for (const [, key] of source.matchAll(/__\('([a-z_.]+)'\)/g)) keys.add(key);
  }
  for (const type of SENSOR_TYPES) keys.add(`thermostat.sensor_type.${type}`);
  for (const { name } of Object.values(INTERFACE_MODES)) keys.add(`han.meter_type.${name}`);
  assert.ok(keys.has('errors.write_not_approved'));
  for (const key of keys) {
    for (const language of LANGUAGES) assert.notEqual(translate(language, key), key, `${key} (${language})`);
  }
});

test('the mode lists in the capability and the Flow cards match the mapping table', () => {
  const ids = (values) => values.map((value) => value.id);
  assert.deepEqual(ids(readJson('.homeycompose/capabilities/futurehome_thermostat_mode.json').values), MODES);
  const flow = readJson('drivers/futurehome-thermostat/driver.flow.compose.json');
  for (const card of [...flow.triggers, ...flow.conditions, ...flow.actions]) {
    const modeArg = (card.args || []).find((arg) => arg.name === 'mode');
    if (modeArg) assert.deepEqual(ids(modeArg.values), MODES, card.id);
  }
});

test('every Flow card in the manifest has a run listener in the driver, and no more', async () => {
  const driver = new ThermostatDriver();
  await driver.onInit();
  const flow = readJson('drivers/futurehome-thermostat/driver.flow.compose.json');
  const kinds = { triggers: 'trigger', conditions: 'condition', actions: 'action' };
  const inManifest = Object.entries(kinds).flatMap(([group, kind]) => flow[group].map((card) => `${kind}:${card.id}`)).sort();
  const registered = Object.entries(driver.homey.cards).filter(([, card]) => card.runListener).map(([key]) => key);
  // Triggers without arguments need no run listener.
  const needListener = inManifest.filter((key) => {
    const [kind, id] = key.split(':');
    const group = Object.keys(kinds).find((name) => kinds[name] === kind);
    return kind !== 'trigger' || (flow[group].find((card) => card.id === id).args || []).length > 0;
  });
  assert.deepEqual(registered.sort(), needListener);
});

test('the app version is the same everywhere and has a changelog in English and Norwegian', () => {
  const { version } = readJson('.homeycompose/app.json');
  assert.equal(readJson('app.json').version, version);
  assert.equal(readJson('package.json').version, version);
  const entry = readJson('.homeychangelog.json')[version];
  assert.equal(typeof entry?.en, 'string', `changelog for ${version} in English`);
  assert.equal(typeof entry?.no, 'string', `changelog for ${version} in Norwegian`);
  assert.match(fs.readFileSync(path.join(APP_DIR, '..', 'CHANGELOG.md'), 'utf8'), new RegExp(`^## ${version.replaceAll('.', '\\.')}$`, 'm'));
});
