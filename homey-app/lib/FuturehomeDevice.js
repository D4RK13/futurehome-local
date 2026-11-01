'use strict';

require('./clusters');
const { ZigBeeDevice } = require('homey-zigbeedriver');
const { APPROVED_WRITES, WriteNotApprovedError, isWriteApproved } = require('./control');

/**
 * Shared logic for Futurehome Zigbee devices: keeps Homey in step with what
 * the device reports, fires Flow triggers on real changes, and refuses every
 * write that Sondre has not approved (lib/control.js).
 *
 * Subclasses implement `deviceKind` and `onZclNodeReady(zclNode)`.
 */
class FuturehomeDevice extends ZigBeeDevice {

  /** @abstract Key in APPROVED_WRITES, e.g. 'thermostat'. */
  get deviceKind() {
    throw new Error('deviceKind is not implemented');
  }

  /** The approved writes. Tests replace this; the app always uses lib/control.js. */
  get approvedWrites() {
    return this._approvedWrites || APPROVED_WRITES;
  }

  async onInit() {
    this.seenValues = {};
    this.nodeReady = new Promise((resolve) => {
      this._resolveNodeReady = resolve;
    });
    await super.onInit();
  }

  /** Called by ZigBeeDevice once the Zigbee node is there. */
  async onNodeInit({ zclNode }) {
    try {
      await this.onZclNodeReady(zclNode);
    } finally {
      this._resolveNodeReady();
    }
  }

  /** @abstract */
  async onZclNodeReady() {}

  /**
   * Runs work from device reports one at a time, in the order they came, so
   * two quick reports cannot overtake each other. Errors are logged.
   */
  enqueue(task, what) {
    this._queue = (this._queue || Promise.resolve())
      .then(task)
      .catch((err) => this.error(`${what} failed:`, err.message));
    return this._queue;
  }

  /** Resolves when all queued report handling is done (used by tests). */
  whenIdle() {
    return this._queue || Promise.resolve();
  }

  /** Throws a clear, translated error unless this kind of write is approved. */
  assertWriteApproved(id) {
    if (isWriteApproved(this.deviceKind, id, this.approvedWrites)) return;
    const error = new WriteNotApprovedError(this.deviceKind, id);
    error.message = this.homey.__('errors.write_not_approved');
    throw error;
  }

  async updateCapability(id, value) {
    if (value === undefined || value === null || !this.hasCapability(id)) return;
    if (this.getCapabilityValue(id) !== value) {
      await this.setCapabilityValue(id, value).catch((err) => this.error(`Setting ${id} failed:`, err.message));
    }
    await this.noteValue(id, value);
  }

  async updateSetting(id, value) {
    if (value === undefined || value === null) return;
    if (this.getSetting(id) === value) return;
    await this.setSettings({ [id]: value }).catch((err) => this.error(`Setting ${id} failed:`, err.message));
  }

  /**
   * Remembers the last value the device reported and calls onValueChanged()
   * once per real change. The first value after start is not a change.
   */
  async noteValue(id, value) {
    const previous = this.seenValues[id];
    this.seenValues[id] = value;
    if (previous === undefined || previous === value) return;
    await this.onValueChanged(id, value, previous)
      .catch((err) => this.error(`Flow trigger for ${id} failed:`, err.message));
  }

  /** Hook for subclasses: a value really changed on the device. */
  async onValueChanged() {}

  async triggerFlow(cardId, tokens = {}, state = {}) {
    await this.homey.flow.getDeviceTriggerCard(cardId).trigger(this, tokens, state)
      .catch((err) => this.error(`Flow trigger ${cardId} failed:`, err.message));
  }

}

module.exports = FuturehomeDevice;
