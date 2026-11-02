# Futurehome Local

A Homey Pro app for Futurehome devices. The devices run directly on Homey's
Zigbee, with no Futurehome hub, cloud, app or subscription.

**Status:** version 0.2.0. The thermostat can be controlled from Homey;
the HAN Sensor is read only. Tested on one thermostat so far.

## Supported devices

| Device | What the app shows |
|---|---|
| Futurehome Smart Thermostat (Co020, Zigbee) | Shows on/off, target, room and floor temperature, heating on/off, energy (kWh), thermostat mode and child lock. On/off, target temperature, mode and child lock can be changed from Homey. Settings: open window detection, hysteresis, temperature calibration; sensor type and floor limit are shown but can only be set on the thermostat (floor protection). Flow cards for mode, heating and child lock. Homey keeps the thermostat's clock right. |
| Futurehome HAN Sensor (GH201E, Zigbee) | Power, imported and exported energy, reactive power, voltage and current per phase, meter type. Can be the main meter in Homey Energy. |

## Adding a device

1. Reset the device (see the guide on Homey's pairing screen).
2. In the Homey app: **Devices → + → Futurehome Local**, then pick the device.
3. Follow the steps on the screen.

The thermostat goes into pairing mode when you hold the minus button for
8 seconds. The HAN Sensor looks for a network when it is plugged into the
meter; the grid company must have opened the HAN port.

## Development

The app is in `homey-app/` (Homey Apps SDK 3, Node.js 24).

```bash
cd homey-app
npm install
npm test                                  # tests with fake Zigbee devices
npx homey app validate --level publish
```

Not affiliated with Futurehome AS or FHSD Connect AS. Device details are
learned from open projects such as Zigbee2MQTT (MIT licence).
