import mqtt from "mqtt";
import { failStep } from "../errors.js";
import type { ActionDefinition, TriggerDefinition } from "../types.js";

export interface ZigbeeConfig {
  mqttUrl: string;
  username?: string;
  password?: string;
  baseTopic: string;
}

type StepDef = ActionDefinition | TriggerDefinition;

export function requireZigbeeConfig(
  integrationConfig: Record<string, unknown>,
  step: StepDef,
  kind: "trigger" | "action",
): ZigbeeConfig {
  const mqttUrl = String(integrationConfig.mqttUrl ?? "").trim();
  const baseTopic = String(integrationConfig.baseTopic ?? "zigbee2mqtt").trim() || "zigbee2mqtt";
  const username = String(integrationConfig.mqttUsername ?? "").trim() || undefined;
  const password = String(integrationConfig.mqttPassword ?? "").trim() || undefined;

  if (!mqttUrl) {
    failStep({
      message: "Zigbee2MQTT broker URL is required — set mqtt://… in Integrations",
      code: "zigbee.missing_config",
      integration: "zigbee",
      step: step.id,
      stepLabel: step.label,
      kind,
      plan: step.actionPlan,
      extras: { device: "", mqttUrl: "", baseTopic },
    });
  }

  return { mqttUrl, username, password, baseTopic };
}

function connectClient(config: ZigbeeConfig): mqtt.MqttClient {
  return mqtt.connect(config.mqttUrl, {
    username: config.username,
    password: config.password,
    reconnectPeriod: 0,
    connectTimeout: 8_000,
  });
}

function withClient<T>(
  config: ZigbeeConfig,
  step: StepDef,
  kind: "trigger" | "action",
  device: string,
  run: (client: mqtt.MqttClient) => Promise<T>,
): Promise<T> {
  const client = connectClient(config);

  return new Promise<T>((resolve, reject) => {
    let settled = false;

    const finish = (err?: Error, value?: T) => {
      if (settled) return;
      settled = true;
      try {
        client.end(true);
      } catch {
        // ignore
      }
      if (err) reject(err);
      else resolve(value as T);
    };

    const timer = setTimeout(() => {
      finish(
        new Error(
          `MQTT timed out talking to ${config.mqttUrl} (device ${device || "unknown"})`,
        ),
      );
    }, 10_000);

    client.on("error", (err) => {
      clearTimeout(timer);
      finish(err instanceof Error ? err : new Error(String(err)));
    });

    client.on("connect", () => {
      run(client)
        .then((value) => {
          clearTimeout(timer);
          finish(undefined, value);
        })
        .catch((err) => {
          clearTimeout(timer);
          finish(err instanceof Error ? err : new Error(String(err)));
        });
    });
  }).catch((err) => {
    failStep({
      message: err instanceof Error ? err.message : "Zigbee MQTT request failed",
      code: "zigbee.mqtt_error",
      integration: "zigbee",
      step: step.id,
      stepLabel: step.label,
      kind,
      plan: step.actionPlan,
      extras: {
        device,
        mqttUrl: config.mqttUrl,
        baseTopic: config.baseTopic,
      },
    });
  });
}

export async function getDeviceState(
  config: ZigbeeConfig,
  friendlyName: string,
  step: StepDef,
  kind: "trigger" | "action",
): Promise<Record<string, unknown>> {
  const device = friendlyName.trim();
  if (!device) {
    failStep({
      message: "Zigbee device friendly name is required",
      code: "zigbee.missing_device",
      integration: "zigbee",
      step: step.id,
      stepLabel: step.label,
      kind,
      plan: step.actionPlan,
      extras: { device: "", mqttUrl: config.mqttUrl, baseTopic: config.baseTopic },
    });
  }

  const topic = `${config.baseTopic}/${device}`;
  const getTopic = `${topic}/get`;

  return withClient(config, step, kind, device, (client) => {
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      let got = false;

      const onMessage = (incomingTopic: string, payload: Buffer) => {
        if (incomingTopic !== topic) return;
        got = true;
        client.off("message", onMessage);
        try {
          const parsed = JSON.parse(payload.toString("utf8")) as unknown;
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            resolve(parsed as Record<string, unknown>);
          } else {
            reject(new Error(`Unexpected payload from ${topic}`));
          }
        } catch (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      };

      client.on("message", onMessage);
      client.subscribe(topic, { qos: 0 }, (err) => {
        if (err) {
          reject(err);
          return;
        }
        // Ask Zigbee2MQTT for a fresh state; retained messages also satisfy this.
        client.publish(getTopic, JSON.stringify({ state: "" }), { qos: 0 });
        setTimeout(() => {
          if (!got) {
            client.off("message", onMessage);
            reject(
              new Error(
                `No state from ${topic} — check the friendly name and that Zigbee2MQTT is publishing`,
              ),
            );
          }
        }, 6_000);
      });
    });
  });
}

export async function publishDeviceSet(
  config: ZigbeeConfig,
  friendlyName: string,
  payload: Record<string, unknown>,
  step: ActionDefinition,
): Promise<void> {
  const device = friendlyName.trim();
  if (!device) {
    failStep({
      message: "Zigbee device friendly name is required",
      code: "zigbee.missing_device",
      integration: "zigbee",
      step: step.id,
      stepLabel: step.label,
      kind: "action",
      plan: step.actionPlan,
      extras: { device: "", mqttUrl: config.mqttUrl, baseTopic: config.baseTopic },
    });
  }

  const topic = `${config.baseTopic}/${device}/set`;
  await withClient(config, step, "action", device, (client) => {
    return new Promise<void>((resolve, reject) => {
      client.publish(topic, JSON.stringify(payload), { qos: 0 }, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  });
}
