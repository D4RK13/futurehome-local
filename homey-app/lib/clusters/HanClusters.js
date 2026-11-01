'use strict';

const { ElectricalMeasurementCluster, MeteringCluster, ZCLDataTypes } = require('zigbee-clusters');

/** Develco Products' Zigbee manufacturer code (zigbee-herdsman's list). */
const DEVELCO_MANUFACTURER_ID = 0x1015;

/**
 * Electrical Measurement (0x0B04) with the attributes the HAN Sensor uses that
 * zigbee-clusters lacks: totals and phases B and C (ZCL spec ids, as in
 * Zigbee2MQTT's Develco EMIZB-132 definition).
 */
class HanElectricalMeasurementCluster extends ElectricalMeasurementCluster {

  static get ATTRIBUTES() {
    return {
      ...super.ATTRIBUTES,
      totalActivePower: { id: 0x0304, type: ZCLDataTypes.int32 },
      totalReactivePower: { id: 0x0305, type: ZCLDataTypes.int32 },
      rmsVoltagePhB: { id: 0x0905, type: ZCLDataTypes.uint16 },
      rmsCurrentPhB: { id: 0x0908, type: ZCLDataTypes.uint16 },
      rmsVoltagePhC: { id: 0x0A05, type: ZCLDataTypes.uint16 },
      rmsCurrentPhC: { id: 0x0A08, type: ZCLDataTypes.uint16 },
    };
  }

}

/**
 * Metering (0x0702) with Develco's interface mode. Develco reports it on id
 * 0x0302, the id of the standard `divisor`, so `divisor` is left out here: the
 * HAN Sensor's energy divisor is fixed at 1000 (Develco's manual, as ZHA does).
 * Read-only in this app: the interface mode is never written.
 */
class HanMeteringCluster extends MeteringCluster {

  static get ATTRIBUTES() {
    const { divisor, ...standard } = super.ATTRIBUTES;
    return {
      ...standard,
      develcoInterfaceMode: { id: 0x0302, type: ZCLDataTypes.uint16, manufacturerId: DEVELCO_MANUFACTURER_ID },
    };
  }

}

module.exports = {
  DEVELCO_MANUFACTURER_ID,
  HanElectricalMeasurementCluster,
  HanMeteringCluster,
};
