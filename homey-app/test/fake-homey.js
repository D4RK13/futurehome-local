'use strict';

/**
 * A tiny stand-in for the `homey` module, just enough to run our Zigbee
 * devices and drivers in tests (same idea as in mill-local). Timers are
 * recorded but never fire; tests call poll() themselves.
 */

const fs = require('node:fs');
const path = require('node:path');

const LOCALES = Object.fromEntries(['en', 'no'].map((language) => [
  language,
  JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'locales', `${language}.json`), 'utf8')),
]));

/** Looks up a key like Homey does; a missing key comes back as the key, so tests notice. */
function translate(language, key) {
  const value = key.split('.').reduce((node, part) => (node ? node[part] : undefined), LOCALES[language]);
  return typeof value === 'string' ? value : key;
}

/** A Flow card: keeps its run listener, and for triggers each trigger() call. */
function createCard() {
  return {
    triggered: [],
    registerRunListener(listener) {
      this.runListener = listener;
      return this;
    },
    async trigger(device, tokens = {}, state = {}) {
      this.triggered.push({ device, tokens, state });
    },
  };
}

function createRuntime({ language = 'en', zigbeeNode = null } = {}) {
  const cards = {};
  const getCard = (kind, id) => {
    cards[`${kind}:${id}`] = cards[`${kind}:${id}`] || createCard();
    return cards[`${kind}:${id}`];
  };
  return {
    cards,
    timers: [],
    setInterval(callback, ms) {
      const timer = { callback, ms };
      this.timers.push(timer);
      return timer;
    },
    clearInterval(timer) {
      this.timers = this.timers.filter((candidate) => candidate !== timer);
    },
    setTimeout(callback, ms) {
      return this.setInterval(callback, ms);
    },
    __: (key) => translate(language, key),
    i18n: { getLanguage: () => language },
    clock: { getTimezone: () => 'Europe/Oslo' },
    zigbee: {
      async getNode() {
        if (!zigbeeNode) throw new Error('No fake Zigbee node in this test');
        return zigbeeNode;
      },
    },
    flow: {
      getActionCard: (id) => getCard('action', id),
      getConditionCard: (id) => getCard('condition', id),
      getDeviceTriggerCard: (id) => getCard('trigger', id),
    },
  };
}

class Device {

  constructor({
    name = 'Test device', data = { token: 'test-token' }, store = {}, settings = {}, capabilities = [],
    zigbeeNode = null, language = 'en',
  } = {}) {
    this.homey = createRuntime({ language, zigbeeNode });
    this.driver = { id: 'test-driver' };
    this._name = name;
    this._data = data;
    this._store = { ...store };
    this._settings = { ...settings };
    this._capabilities = [...capabilities];
    this._values = {};
    this._listeners = {};
    this._available = true;
    this.unavailableMessage = null;
    this.errors = [];
    this.logs = [];
  }

  async onInit() {}

  log(...args) {
    this.logs.push(args);
  }

  error(...args) {
    this.errors.push(args);
  }

  getName() { return this._name; }

  getData() { return this._data; }

  getStore() { return { ...this._store }; }

  getStoreValue(key) { return this._store[key]; }

  async setStoreValue(key, value) { this._store[key] = value; }

  getSettings() { return { ...this._settings }; }

  getSetting(id) { return id in this._settings ? this._settings[id] : null; }

  async setSettings(settings) { Object.assign(this._settings, settings); }

  getCapabilities() { return [...this._capabilities]; }

  hasCapability(id) { return this._capabilities.includes(id); }

  async addCapability(id) { this._capabilities.push(id); }

  async removeCapability(id) {
    this._capabilities = this._capabilities.filter((candidate) => candidate !== id);
    delete this._values[id];
  }

  getCapabilityValue(id) { return id in this._values ? this._values[id] : null; }

  async setCapabilityValue(id, value) {
    if (!this.hasCapability(id)) throw new Error(`Invalid capability: ${id}`);
    this._values[id] = value;
  }

  registerCapabilityListener(id, listener) { this._listeners[id] = listener; }

  hasCapabilityListener(id) { return typeof this._listeners[id] === 'function'; }

  /** Test helper: what Homey does when the user changes a capability (keeps the value only if the listener succeeds). */
  async triggerCapability(id, value) {
    await this._listeners[id](value);
    this._values[id] = value;
  }

  /** Test helper: what Homey does when the user saves settings (keeps them only if onSettings succeeds). */
  async changeSettings(changes) {
    const oldSettings = this.getSettings();
    const newSettings = { ...oldSettings, ...changes };
    await this.onSettings({ oldSettings, newSettings, changedKeys: Object.keys(changes) });
    this._settings = newSettings;
  }

  getAvailable() { return this._available; }

  async setAvailable() {
    this._available = true;
    this.unavailableMessage = null;
  }

  async setUnavailable(message) {
    this._available = false;
    this.unavailableMessage = message;
  }

  onDeleted() {}

}

class Driver {

  constructor({ language = 'en' } = {}) {
    this.homey = createRuntime({ language });
  }

  log() {}

  error() {}

}

class App {

  constructor() {
    this.homey = createRuntime();
  }

  log() {}

}

/** Makes `require('homey')` load this file. Call once, before requiring app code. */
function installFakeHomey() {
  const Module = require('node:module');
  const originalResolve = Module._resolveFilename;
  Module._resolveFilename = function resolveFilename(request, ...rest) {
    if (request === 'homey') return __filename;
    return originalResolve.call(this, request, ...rest);
  };
}

module.exports = {
  Device,
  Driver,
  App,
  installFakeHomey,
  translate,
};
