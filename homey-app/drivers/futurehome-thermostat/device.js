'use strict';

const FuturehomeDevice = require('../../lib/FuturehomeDevice');
const { THERMOSTAT_DATAPOINTS } = require('../../lib/thermostat-mapping');
const { encodeDatapoint, describeValue } = require('../../lib/tuya/datapoints');
const { timeSyncPayload } = require('../../lib/tuya/time');
const { isWriteApproved } = require('../../lib/control');

const TUYA_ENDPOINT = 1;
const UNKNOWN_DATAPOINTS_STORE_KEY = 'unknownDatapoints';

/** Basic attributes Tuya devices are read for after joining (Z2M's "magic packet"). Read only. */
const BASIC_INFO = ['manufacturerName', 'zclVersion', 'appVersion', 'modelId', 'powerSource', 'attributeReportingStatus'];

/**
 * Futurehome Smart Thermostat PR (Co020). Everything goes through Tuya
 * datapoints on endpoint 1 (interview of thermostat A, 2026-11-01).
 */
class FuturehomeThermostatDevice extends FuturehomeDevice {

  get deviceKind() {
    return 'thermostat';
  }

  async onZclNodeReady(zclNode) {
    const endpoint = zclNode.endpoints[TUYA_ENDPOINT];
    this.tuya = endpoint && endpoint.clusters.tuya;
    if (!this.tuya) {
      await this.setUnavailable(this.homey.__('errors.no_tuya_cluster'));
      return;
    }

    this.unknownDatapoints = { ...(this.getStoreValue(UNKNOWN_DATAPOINTS_STORE_KEY) || {}) };
    this.tuya.on('datapoints', (datapoints) => this.enqueue(() => this.onDatapoints(datapoints), 'Handling datapoints'));
    this.tuya.on('timeRequest', () => this.enqueue(() => this.onTimeRequest(), 'Answering the time request'));

    for (const row of THERMOSTAT_DATAPOINTS) {
      if (row.kind === 'capability' && row.toDevice && this.hasCapability(row.id)) {
        this.registerCapabilityListener(row.id, (value) => this.writeDatapoint(row, value));
      }
    }

    if (this.isFirstInit()) await this.readBasicInfo(endpoint);
    await this.queryDatapoints();
  }

  async readBasicInfo(endpoint) {
    try {
      const info = await endpoint.clusters.basic.readAttributes(BASIC_INFO);
      this.log('Basic info:', info);
    } catch (err) {
      this.error('Reading basic info failed:', err.message);
    }
  }

  /** Asks the thermostat to report all its datapoints. Changes nothing on it. */
  async queryDatapoints() {
    await this.tuya.dataQuery({}, { waitForResponse: false })
      .catch((err) => this.error('Datapoint query failed:', err.message));
  }

  async onDatapoints(datapoints) {
    for (const datapoint of datapoints) {
      const row = THERMOSTAT_DATAPOINTS.find((candidate) => candidate.dp === datapoint.dp);
      if (!row) {
        await this.noteUnknownDatapoint(datapoint);
      } else if (row.kind === 'label') {
        await this.updateSetting(row.id, row.label(datapoint.value, (key) => this.homey.__(key)));
      } else {
        let value = row.fromDevice(datapoint.value);
        if (row.id === 'meter_power') value = this.keepEnergyRising(value);
        if (row.kind === 'capability') await this.updateCapability(row.id, value);
        else await this.updateSetting(row.id, value);
      }
    }
  }

  /** The energy counter only goes up; a lower reading (except a reset to 0) is a glitch (Z2M). */
  keepEnergyRising(kWh) {
    const last = this.getCapabilityValue('meter_power');
    if (typeof last === 'number' && kWh < last && kWh !== 0) return undefined;
    return kWh;
  }

  /** Datapoints the app does not understand yet go to the diagnostics setting, for Phase 3. */
  async noteUnknownDatapoint(datapoint) {
    const text = describeValue(datapoint);
    if (this.unknownDatapoints[datapoint.dp] === text) return;
    this.unknownDatapoints[datapoint.dp] = text;
    this.log(`Unknown datapoint ${datapoint.dp} (${datapoint.type}):`, text);
    await this.setStoreValue(UNKNOWN_DATAPOINTS_STORE_KEY, this.unknownDatapoints);
    const summary = Object.keys(this.unknownDatapoints)
      .map(Number)
      .sort((a, b) => a - b)
      .map((dp) => `${dp}: ${this.unknownDatapoints[dp]}`)
      .join(' · ');
    await this.updateSetting('unknown_datapoints', summary);
  }

  async writeDatapoint(row, value) {
    this.assertWriteApproved(row.id);
    await this.sendDatapoint(row.dp, row.type, row.toDevice(value));
  }

  async sendDatapoint(dp, type, raw) {
    this.sequence = ((this.sequence || 0) + 1) % 0x10000;
    // As Zigbee2MQTT: no default response; the thermostat confirms with a datapoint report.
    await this.tuya.dataRequest(
      { seq: this.sequence, payload: encodeDatapoint(dp, type, raw) },
      { waitForResponse: false, disableDefaultResponse: true },
    );
  }

  async onSettings({ newSettings, changedKeys }) {
    const rows = THERMOSTAT_DATAPOINTS.filter((row) => row.kind === 'setting' && changedKeys.includes(row.id));
    // Check them all first, so a refused change does not leave the others half sent.
    for (const row of rows) this.assertWriteApproved(row.id);
    const raws = rows.map((row) => row.toDevice(newSettings[row.id]));
    for (const [index, row] of rows.entries()) {
      await this.sendDatapoint(row.dp, row.type, raws[index]);
    }
  }

  /** From a Flow card: the same path as the Homey app, so the same approval applies. */
  async setCapabilityFromFlow(id, value) {
    const row = THERMOSTAT_DATAPOINTS.find((candidate) => candidate.id === id && candidate.kind === 'capability');
    if (!row || !row.toDevice) throw new Error(`"${id}" cannot be changed`);
    await this.writeDatapoint(row, value);
  }

  async setSettingFromFlow(id, value) {
    const row = THERMOSTAT_DATAPOINTS.find((candidate) => candidate.id === id && candidate.kind === 'setting');
    if (!row || !row.toDevice) throw new Error(`"${id}" cannot be changed`);
    await this.writeDatapoint(row, value);
    await this.setSettings({ [id]: value });
  }

  /** The thermostat asks for the time. Answering sets its clock, so it needs approval too. */
  async onTimeRequest() {
    if (!isWriteApproved(this.deviceKind, 'time_sync', this.approvedWrites)) {
      this.log('The thermostat asked for the time; not answered (time_sync is not approved)');
      return;
    }
    const payload = timeSyncPayload(Date.now(), this.homey.clock.getTimezone());
    await this.tuya.timeSync({ payload }, { waitForResponse: false, disableDefaultResponse: true });
  }

  async onValueChanged(id, value) {
    if (id === 'futurehome_thermostat_mode') {
      await this.triggerFlow('thermostat_mode_changed', { mode: value }, { value });
    } else if (id === 'futurehome_heating') {
      await this.triggerFlow(value ? 'heating_started' : 'heating_stopped');
    } else if (id === 'futurehome_child_lock') {
      await this.triggerFlow('child_lock_changed', {}, { value: value ? 'on' : 'off' });
    }
  }

}

module.exports = FuturehomeThermostatDevice;
