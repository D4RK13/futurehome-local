# Changelog

## 0.2.0

- Control the Futurehome Smart Thermostat from Homey: target temperature
  (5–35 °C), on/off, thermostat mode, child lock, open window detection,
  hysteresis and temperature calibration, from the Homey app, Flows and the
  device settings.
- Homey answers the thermostat's request for the time, so its clock is right.
- The sensor type and floor limit (the floor protection) can still only be
  set on the thermostat itself.
- The HAN Sensor still only reads.

## 0.1.0

- First version, not tried on real devices yet.
- Futurehome Smart Thermostat (Co020, Zigbee): reads on/off, target and room
  temperature, floor temperature, heating on/off, energy (kWh), thermostat
  mode and child lock; settings for open window detection, hysteresis,
  temperature calibration; shows the sensor type and floor limit (read only).
- Futurehome HAN Sensor (GH201E, Zigbee): reads power, imported and exported
  energy, reactive power, and voltage and current per phase; shows the meter
  type. Works as the main meter in Homey Energy.
- Pairing guides with pictures in English and Norwegian.
- Control from Homey is not turned on yet: the app only reads the devices.
