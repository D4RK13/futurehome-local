'use strict';

/**
 * A fake of Homey's ZigBeeNode, the object zigbee-clusters talks through.
 * Frames are real ZCL bytes, so the tests run the real zigbee-clusters
 * parsing and our real cluster classes.
 *
 * - Answers attribute reads from `attributes[endpoint][clusterId][attributeId]`.
 * - Records every frame the app sends, so tests can prove that nothing but
 *   reads, queries and acknowledgements left the app.
 * - Lets a test play the device: Tuya datapoint reports, attribute reports and
 *   time requests.
 */

const { EventEmitter } = require('node:events');
const { Cluster, Endpoint } = require('zigbee-clusters');
const { ZCLStandardHeader, ZCLMfgSpecificHeader } = require('zigbee-clusters/lib/zclFrames');
const { encodeDatapoint } = require('../lib/tuya/datapoints');

const TUYA_CLUSTER_ID = 0xEF00;
const GLOBAL = { readAttributes: 0x00, readAttributesResponse: 0x01, reportAttributes: 0x0A, defaultResponse: 0x0B };

class FakeZigbeeNode extends EventEmitter {

  /**
   * @param {object} options
   * @param {object[]} options.endpointDescriptors - as in the Homey interview
   * @param {object} [options.attributes] - { [endpointId]: { [clusterId]: { [attributeId]: value } } }
   */
  constructor({ endpointDescriptors, attributes = {} }) {
    super();
    this.endpointDescriptors = endpointDescriptors;
    this.attributes = attributes;
    this.sent = [];
    this.offline = false;
    this.deviceTsn = 100;
  }

  /** Called by zigbee-clusters for every frame the app sends. */
  async sendFrame(endpointId, clusterId, buffer) {
    if (this.offline) throw new Error('Could not reach the device');
    const frame = Endpoint.parseFrame(buffer);
    this.sent.push({ endpointId, clusterId, frame });
    if (!frame.frameControl.clusterSpecific && frame.cmdId === GLOBAL.readAttributes) {
      setImmediate(() => this.answerRead(endpointId, clusterId, frame));
    }
  }

  answerRead(endpointId, clusterId, request) {
    const ids = [];
    for (let offset = 0; offset + 1 < request.data.length; offset += 2) ids.push(request.data.readUInt16LE(offset));
    const known = ((this.attributes[endpointId] || {})[clusterId]) || {};
    const records = ids.map((id) => (id in known
      ? { id, status: 'SUCCESS', value: known[id] }
      : { id, status: 'UNSUPPORTED_ATTRIBUTE' }));
    const ClusterClass = Cluster.getCluster(clusterId);
    const data = Buffer.alloc(512);
    const length = ClusterClass.attributeArrayStatusDataType.toBuffer(data, records, 0);
    const fields = {
      frameControl: ['directionToClient', 'disableDefaultResponse'],
      trxSequenceNumber: request.trxSequenceNumber,
      cmdId: GLOBAL.readAttributesResponse,
      data: data.subarray(0, length),
    };
    let response;
    if (request.frameControl.manufacturerSpecific) {
      fields.frameControl.push('manufacturerSpecific');
      response = new ZCLMfgSpecificHeader({ ...fields, manufacturerId: request.manufacturerId });
    } else {
      response = new ZCLStandardHeader(fields);
    }
    this.handleFrame(endpointId, clusterId, response.toBuffer(), {});
  }

  nextTsn() {
    this.deviceTsn = (this.deviceTsn + 1) % 256;
    return this.deviceTsn;
  }

  /** The device reports Tuya datapoints, e.g. [{ dp: 16, type: 'value', value: 22 }]. Raw ones take `hex`. */
  async reportDatapoints(datapoints, { endpointId = 1, cmdId = 0x02 } = {}) {
    const records = datapoints.map(({ dp, type, value, hex }) => {
      if (type === 'raw') {
        const data = Buffer.from(hex, 'hex');
        const header = Buffer.from([dp, 0x00, 0, 0]);
        header.writeUInt16BE(data.length, 2);
        return Buffer.concat([header, data]);
      }
      return encodeDatapoint(dp, type, value);
    });
    const seq = Buffer.alloc(2);
    seq.writeUInt16LE(this.deviceTsn, 0);
    const frame = new ZCLStandardHeader({
      frameControl: ['clusterSpecific', 'directionToClient'],
      trxSequenceNumber: this.nextTsn(),
      cmdId,
      data: Buffer.concat([seq, ...records]),
    });
    await this.handleFrame(endpointId, TUYA_CLUSTER_ID, frame.toBuffer(), {});
  }

  /** The thermostat asks for the time (Tuya command 0x24). */
  async requestTime({ endpointId = 1 } = {}) {
    const frame = new ZCLStandardHeader({
      frameControl: ['clusterSpecific', 'directionToClient'],
      trxSequenceNumber: this.nextTsn(),
      cmdId: 0x24,
      data: Buffer.alloc(0),
    });
    await this.handleFrame(endpointId, TUYA_CLUSTER_ID, frame.toBuffer(), {});
  }

  /** The device reports attributes on its own, e.g. { 0x0304: 1500 }. */
  async reportAttributes(endpointId, clusterId, values) {
    const ClusterClass = Cluster.getCluster(clusterId);
    const records = Object.entries(values).map(([id, value]) => ({ id: Number(id), value }));
    const data = Buffer.alloc(512);
    const length = ClusterClass.attributeArrayDataType.toBuffer(data, records, 0);
    const frame = new ZCLStandardHeader({
      frameControl: ['directionToClient'],
      trxSequenceNumber: this.nextTsn(),
      cmdId: GLOBAL.reportAttributes,
      data: data.subarray(0, length),
    });
    await this.handleFrame(endpointId, clusterId, frame.toBuffer(), {});
  }

  /** Frames that are not reads, Tuya queries or acknowledgements: anything that could change the device. */
  writesSent() {
    return this.sent.filter(({ clusterId, frame }) => {
      const global = !frame.frameControl.clusterSpecific;
      if (global && (frame.cmdId === GLOBAL.readAttributes || frame.cmdId === GLOBAL.defaultResponse)) return false;
      if (!global && clusterId === TUYA_CLUSTER_ID && frame.cmdId === 0x03) return false;
      return true;
    });
  }

  /** Tuya "set datapoint" frames the app sent. */
  tuyaWrites() {
    return this.sent.filter(({ clusterId, frame }) => clusterId === TUYA_CLUSTER_ID && frame.frameControl.clusterSpecific && frame.cmdId === 0x00);
  }

}

/** Thermostat A's endpoint, from its interview (2026-11-01). */
const THERMOSTAT_ENDPOINTS = [
  { endpointId: 1, inputClusters: [0, 4, 5, 61184], outputClusters: [25, 10] },
];

/** The HAN Sensor's endpoint as Z2M and ZHA describe it. Not yet confirmed on Sondre's sensor. */
const HAN_ENDPOINTS = [
  { endpointId: 2, inputClusters: [0, 1794, 2820], outputClusters: [] },
];

module.exports = {
  FakeZigbeeNode,
  THERMOSTAT_ENDPOINTS,
  HAN_ENDPOINTS,
  TUYA_CLUSTER_ID,
};
