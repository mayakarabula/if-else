import type { TriggerDefinition } from "../types.js";
import {
  formatNodeList,
  isIpPresent,
  isValidIpv4,
  scanLocalNodes,
} from "./scan.js";

export const deviceOnNetwork: TriggerDefinition = {
  id: "device_on_network",
  label: "Device IP is on the network",
  description: "Scans the local Wi‑Fi/LAN and fires when a device with this IP is found.",
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
      throw new Error("Enter a valid IPv4 address");
    }

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

    // First observation only seeds state for edge modes.
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
  },
};

export const scanNetwork: TriggerDefinition = {
  id: "scan_network",
  label: "Scan for network devices",
  description: "Discovers devices on your local Wi‑Fi/LAN. Use as a data source for templates.",
  kind: "data",
  fields: [],
  outputs: [
    { path: "subnet", label: "Subnet", description: "Detected local network, e.g. 192.168.1.10/24" },
    { path: "count", label: "Device count" },
    { path: "nodes", label: "Devices", description: "One device per line: IP (and MAC when known)" },
    { path: "ips", label: "IP list", description: "One IP address per line" },
  ],
  async evaluate() {
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
  },
};
