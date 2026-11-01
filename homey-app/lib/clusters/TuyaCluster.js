'use strict';

const { Cluster, ZCLDataTypes } = require('zigbee-clusters');
const { parseDatapoints } = require('../tuya/datapoints');

/**
 * Tuya's own cluster (0xEF00). Tuya devices such as the Futurehome Smart
 * Thermostat send all their values here as datapoints instead of using
 * standard Zigbee clusters. Command ids from Zigbee2MQTT (MIT).
 *
 * Events:
 *   'datapoints' (datapoints[]) - the device reported one or more datapoints
 *   'timeRequest' ()           - the device asked for the time
 */

const FRAME = {
  seq: ZCLDataTypes.uint16,
  payload: ZCLDataTypes.buffer,
};

class TuyaCluster extends Cluster {

  static get ID() {
    return 0xEF00;
  }

  static get NAME() {
    return 'tuya';
  }

  static get ATTRIBUTES() {
    return {};
  }

  static get COMMANDS() {
    return {
      // To the device: set datapoints. Changes the device, so only behind approval.
      dataRequest: { id: 0x00, args: FRAME },
      // From the device: answer to a dataRequest or dataQuery.
      dataResponse: { id: 0x01, args: FRAME, direction: Cluster.DIRECTION_SERVER_TO_CLIENT },
      // From the device: a value changed on its own.
      dataReport: { id: 0x02, args: FRAME, direction: Cluster.DIRECTION_SERVER_TO_CLIENT },
      // To the device: "report all your datapoints". Read only.
      dataQuery: { id: 0x03 },
      // Both ways: the device asks for the time, the hub answers with it.
      timeSync: { id: 0x24, args: { payload: ZCLDataTypes.buffer } },
    };
  }

  onDataResponse({ payload }) {
    this.emit('datapoints', parseDatapoints(payload));
  }

  onDataReport({ payload }) {
    this.emit('datapoints', parseDatapoints(payload));
  }

  onTimeSync() {
    this.emit('timeRequest');
  }

}

module.exports = TuyaCluster;
