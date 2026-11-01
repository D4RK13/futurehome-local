'use strict';

require('../../lib/clusters');
const { ZigBeeDriver } = require('homey-zigbeedriver');

/** The HAN Sensor only reads, and Homey makes the Flow cards for its values itself. */
class FuturehomeHanSensorDriver extends ZigBeeDriver {}

module.exports = FuturehomeHanSensorDriver;
