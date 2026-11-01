'use strict';

const { Cluster } = require('zigbee-clusters');
const TuyaCluster = require('./TuyaCluster');
const { HanElectricalMeasurementCluster, HanMeteringCluster } = require('./HanClusters');

/**
 * Registers our cluster classes with zigbee-clusters, once per app process.
 * Must run before Homey builds a ZCLNode for a device, so device.js files
 * require this module at the top.
 */
Cluster.addCluster(TuyaCluster);
Cluster.addCluster(HanElectricalMeasurementCluster);
Cluster.addCluster(HanMeteringCluster);

module.exports = {
  TuyaCluster,
  HanElectricalMeasurementCluster,
  HanMeteringCluster,
};
