import { failStep } from "../errors.js";
import type { TriggerDefinition } from "../types.js";
import {
  formatNodeList,
  isIpPresent,
  isValidIpv4,
  scanLocalNodes,
} from "./scan.js";

const COMMON_ERROR_CALLBACK = [
  { path: "message", label: "Error message" },
  { path: "code", label: "Error code" },
  { path: "integration", label: "Integration id" },
  { path: "step", label: "Step id" },
  { path: "stepLabel", label: "Step label" },
  { path: "kind", label: "Step kind", description: "trigger or action" },
  { path: "plan", label: "Action plan", description: "Planned steps joined with →" },
];

export const deviceOnNetwork: TriggerDefinition = {
  id: "device_on_network",
  label: "Device IP is on the network",
  description: "Scans the local Wi‑Fi/LAN and fires when a device with this IP is found.",
  actionPlan: [
    "Validate the configured IPv4 address",
    "Probe the local LAN (ARP + ping) for that IP",
    "Apply online / appears / disappears mode and fire when matched",
  ],
  errorCallback: [
    ...COMMON_ERROR_CALLBACK,
    { path: "ip", label: "IP address", description: "IP that failed validation or scan" },
  ],
  fields: [
    {
      key: "ip",
      label: "IP address",
      type: "text",
      required: true,
      placeholder: "192.168.1.42",
    },
    {
      key: "mode",
      label: "When",
      type: "select",
      required: true,
      default: "online",
      options: [
        { value: "online", label: "While the device is online" },
        { value: "appears", label: "When the device comes online" },
        { value: "disappears", label: "When the device goes offline" },
      ],
    },
  ],
  outputs: [
    { path: "ip", label: "IP address" },
    { path: "present", label: "Present", description: "true if the device responded" },
    { path: "mac", label: "MAC address", description: "From ARP when available" },
    { path: "mode", label: "Mode" },
  ],
  async evaluate(config, context) {
    const ip = String(config.ip ?? "").trim();
    const mode = String(config.mode ?? "online");
    if (!isValidIpv4(ip)) {
      failStep({
        message: "Enter a valid IPv4 address",
        code: "wifi.invalid_ip",
        integration: "wifi",
        step: "device_on_network",
        stepLabel: deviceOnNetwork.label,
        kind: "trigger",
        plan: deviceOnNetwork.actionPlan,
        extras: { ip },
      });
    }

    try {
      const { present, mac } = await isIpPresent(ip);
      const previous = context.lastState?.present;
      const wasPresent = Boolean(previous);
      const data = {
        ip,
        present,
        mac: mac ?? "",
        mode,
      };

      if (context.manual) {
        return {
          fired: mode === "disappears" ? !present : present,
          data,
          state: { present },
        };
      }

      if ((mode === "appears" || mode === "disappears") && previous === undefined) {
        return {
          fired: false,
          data,
          state: { present },
        };
      }

      let fired = false;
      if (mode === "appears") {
        fired = present && !wasPresent;
      } else if (mode === "disappears") {
        fired = !present && wasPresent;
      } else {
        fired = present;
      }

      return {
        fired,
        data,
        state: { present },
      };
    } catch (err) {
      failStep({
        message: err instanceof Error ? err.message : "Network scan failed",
        code: "wifi.scan_failed",
        integration: "wifi",
        step: "device_on_network",
        stepLabel: deviceOnNetwork.label,
        kind: "trigger",
        plan: deviceOnNetwork.actionPlan,
        extras: { ip },
      });
    }
  },
};

export const scanNetwork: TriggerDefinition = {
  id: "scan_network",
  label: "Scan for network devices",
  description: "Discovers devices on your local Wi‑Fi/LAN. Use as a data source for templates.",
  kind: "data",
  actionPlan: [
    "Detect the local subnet for this machine",
    "Scan LAN hosts with ARP and ping",
    "Expose device list, IPs, and count for templates",
  ],
  errorCallback: [
    ...COMMON_ERROR_CALLBACK,
    { path: "subnet", label: "Subnet", description: "Subnet that failed to scan when known" },
  ],
  fields: [],
  outputs: [
    { path: "subnet", label: "Subnet", description: "Detected local network, e.g. 192.168.1.10/24" },
    { path: "count", label: "Device count" },
    { path: "nodes", label: "Devices", description: "One device per line: IP (and MAC when known)" },
    { path: "ips", label: "IP list", description: "One IP address per line" },
  ],
  async evaluate() {
    try {
      const { subnet, nodes } = await scanLocalNodes();
      return {
        fired: true,
        data: {
          subnet,
          count: nodes.length,
          nodes: formatNodeList(nodes),
          ips: nodes.map((node) => node.ip).join("\n"),
        },
      };
    } catch (err) {
      failStep({
        message: err instanceof Error ? err.message : "Network scan failed",
        code: "wifi.scan_failed",
        integration: "wifi",
        step: "scan_network",
        stepLabel: scanNetwork.label,
        kind: "trigger",
        plan: scanNetwork.actionPlan,
        extras: { subnet: "" },
      });
    }
  },
};
