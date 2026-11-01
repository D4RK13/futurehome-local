'use strict';

require('../../lib/clusters');
const { ZigBeeDriver } = require('homey-zigbeedriver');

class FuturehomeThermostatDriver extends ZigBeeDriver {

  async onInit() {
    const { flow } = this.homey;

    // When
    flow.getDeviceTriggerCard('thermostat_mode_changed')
      .registerRunListener(({ mode }, { value }) => mode === value);
    flow.getDeviceTriggerCard('child_lock_changed')
      .registerRunListener(({ state }, { value }) => state === value);

    // And
    flow.getConditionCard('thermostat_mode_is')
      .registerRunListener(({ device, mode }) => device.getCapabilityValue('futurehome_thermostat_mode') === mode);
    flow.getConditionCard('is_heating')
      .registerRunListener(({ device }) => device.getCapabilityValue('futurehome_heating') === true);
    flow.getConditionCard('child_lock_is_on')
      .registerRunListener(({ device }) => device.getCapabilityValue('futurehome_child_lock') === true);

    // Then (each one needs an approved write, see lib/control.js)
    flow.getActionCard('set_thermostat_mode')
      .registerRunListener(({ device, mode }) => device.setCapabilityFromFlow('futurehome_thermostat_mode', mode));
    flow.getActionCard('set_child_lock')
      .registerRunListener(({ device, state }) => device.setCapabilityFromFlow('futurehome_child_lock', state === 'on'));
    flow.getActionCard('set_open_window_detection')
      .registerRunListener(({ device, state }) => device.setSettingFromFlow('open_window_detection', state === 'on'));
  }

}

module.exports = FuturehomeThermostatDriver;
