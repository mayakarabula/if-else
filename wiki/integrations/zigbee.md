# Zigbee (Zigbee2MQTT)

Configure under **Integrations → Zigbee** with your MQTT broker URL (optional credentials / base topic, default `zigbee2mqtt`).

- Conditions read device state over MQTT
- Actions publish to `<device>/set` (state, brightness, raw set)
