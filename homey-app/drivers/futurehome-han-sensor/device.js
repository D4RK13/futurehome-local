'use strict';

const FuturehomeDevice = require('../../lib/FuturehomeDevice');
const { HanElectricalMeasurementCluster } = require('../../lib/clusters');
const {
  HAN_ENDPOINT, HAN_ATTRIBUTES, attributesToPoll, currentDivisorFor,
} = require('../../lib/han-mapping');

const POLL_INTERVAL_MS = 30 * 1000;
// One failed read is often a hiccup; three in a row (about 1.5 minutes) is a lost connection.
const UNAVAILABLE_AFTER_FAILURES = 3;
const INTERFACE_MODE_STORE_KEY = 'interfaceMode';
const POLLED_CLUSTERS = ['electricalMeasurement', 'metering'];

/**
 * Futurehome HAN Sensor (GH201E, Develco). Read-only: listens for reports and
 * reads the values every 30 s. It never writes to the sensor.
 */
class FuturehomeHanSensorDevice extends FuturehomeDevice {

  get deviceKind() {
    return 'han';
  }

  async onZclNodeReady(zclNode) {
    const endpoint = zclNode.endpoints[HAN_ENDPOINT];
    if (!endpoint) {
      await this.setUnavailable(this.homey.__('errors.no_han_endpoint'));
      return;
    }
    // Z2M adds Electrical Measurement by hand: the sensor may not announce it.
    if (!endpoint.clusters.electricalMeasurement) {
      this.log('Electrical Measurement not announced; adding it, as Zigbee2MQTT does');
      endpoint.clusters.electricalMeasurement = new HanElectricalMeasurementCluster(endpoint);
    }
    this.clusters = {
      electricalMeasurement: endpoint.clusters.electricalMeasurement,
      metering: endpoint.clusters.metering,
    };
    this.currentDivisor = currentDivisorFor(this.getStoreValue(INTERFACE_MODE_STORE_KEY));
    this.failedPolls = 0;

    for (const row of HAN_ATTRIBUTES) {
      const cluster = this.clusters[row.cluster];
      if (!cluster) continue;
      cluster.on(`attr.${row.attribute}`, (raw) => this.enqueue(() => this.onAttribute(row, raw), `Handling ${row.attribute}`));
    }

    await this.readInterfaceMode();
    await this.poll();
    this.pollTimer = this.homey.setInterval(() => this.poll(), POLL_INTERVAL_MS);
  }

  async onAttribute(row, raw) {
    if (raw === undefined || raw === null) return;
    if (row.attribute === 'develcoInterfaceMode') {
      this.currentDivisor = currentDivisorFor(raw);
      await this.setStoreValue(INTERFACE_MODE_STORE_KEY, raw);
    }
    if (row.kind === 'label') {
      await this.updateSetting(row.id, row.label(raw, (key) => this.homey.__(key)));
      return;
    }
    await this.updateCapability(row.id, row.fromDevice(raw, { currentDivisor: this.currentDivisor }));
  }

  /** Develco's meter type sits in a manufacturer-specific attribute, read on its own. */
  async readInterfaceMode() {
    if (!this.clusters.metering) return;
    try {
      const { develcoInterfaceMode } = await this.clusters.metering.readAttributes(['develcoInterfaceMode']);
      const row = HAN_ATTRIBUTES.find((candidate) => candidate.attribute === 'develcoInterfaceMode');
      await this.onAttribute(row, develcoInterfaceMode);
    } catch (err) {
      this.error('Reading the meter type failed:', err.message);
    }
  }

  async poll() {
    let anyRead = false;
    let lastError = null;
    for (const clusterName of POLLED_CLUSTERS) {
      const cluster = this.clusters[clusterName];
      if (!cluster) continue;
      try {
        const values = await cluster.readAttributes(attributesToPoll(clusterName));
        anyRead = true;
        for (const row of HAN_ATTRIBUTES.filter((candidate) => candidate.cluster === clusterName)) {
          if (row.attribute in values) await this.onAttribute(row, values[row.attribute]);
        }
      } catch (err) {
        lastError = err;
        this.error(`Reading ${clusterName} failed:`, err.message);
      }
    }

    if (anyRead) {
      this.failedPolls = 0;
      if (!this.getAvailable()) await this.setAvailable().catch(this.error);
      return;
    }
    this.failedPolls += 1;
    if (this.failedPolls >= UNAVAILABLE_AFTER_FAILURES) {
      const reason = lastError ? lastError.message : '';
      await this.setUnavailable(`${this.homey.__('errors.han_no_answer')} ${reason}`.trim()).catch(this.error);
    }
  }

  stopPolling() {
    if (this.pollTimer) this.homey.clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  async onUninit() {
    this.stopPolling();
  }

  onDeleted() {
    this.stopPolling();
    super.onDeleted();
  }

}

module.exports = FuturehomeHanSensorDevice;
