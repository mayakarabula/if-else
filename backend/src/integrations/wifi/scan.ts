import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import { readFile } from "node:fs/promises";

const execFileAsync = promisify(execFile);

const IPV4_RE =
  /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d?\d)$/;

export function isValidIpv4(value: string): boolean {
  return IPV4_RE.test(value.trim());
}

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

function intToIpv4(value: number): string {
  return [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join(".");
}

function prefixFromNetmask(netmask: string): number {
  const bits = ipv4ToInt(netmask)
    .toString(2)
    .split("")
    .filter((bit) => bit === "1").length;
  return bits;
}

export interface LocalSubnet {
  address: string;
  netmask: string;
  prefix: number;
  iface: string;
  cidr: string;
}

/** Prefer a private LAN interface over loopback / link-local. */
export function detectLocalSubnet(): LocalSubnet | null {
  const preferred: LocalSubnet[] = [];
  const others: LocalSubnet[] = [];

  for (const [iface, addresses] of Object.entries(os.networkInterfaces())) {
    for (const entry of addresses ?? []) {
      if (entry.family !== "IPv4" || entry.internal || !entry.netmask) continue;
      const prefix = prefixFromNetmask(entry.netmask);
      if (prefix < 8 || prefix > 30) continue;

      const item: LocalSubnet = {
        address: entry.address,
        netmask: entry.netmask,
        prefix,
        iface,
        cidr: `${entry.address}/${prefix}`,
      };

      if (
        entry.address.startsWith("10.") ||
        entry.address.startsWith("192.168.") ||
        /^172\.(1[6-9]|2\d|3[0-1])\./.test(entry.address)
      ) {
        preferred.push(item);
      } else {
        others.push(item);
      }
    }
  }

  return preferred[0] ?? others[0] ?? null;
}

function hostsForSubnet(subnet: LocalSubnet, limit = 256): string[] {
  const addressInt = ipv4ToInt(subnet.address);
  const mask = subnet.prefix === 0 ? 0 : (~0 << (32 - subnet.prefix)) >>> 0;
  const network = (addressInt & mask) >>> 0;
  const broadcast = (network | (~mask >>> 0)) >>> 0;
  const hosts: string[] = [];

  for (let host = network + 1; host < broadcast; host += 1) {
    const ip = intToIpv4(host >>> 0);
    if (ip === subnet.address) continue;
    hosts.push(ip);
    if (hosts.length >= limit) break;
  }

  return hosts;
}

async function pingHost(ip: string, timeoutMs = 700): Promise<boolean> {
  const timeoutSec = Math.max(1, Math.ceil(timeoutMs / 1000));
  try {
    await execFileAsync("ping", ["-c", "1", "-W", String(timeoutSec), ip], {
      timeout: timeoutMs + 400,
    });
    return true;
  } catch {
    return false;
  }
}

/** Parse Linux ARP/neighbor cache for IPv4 entries that look alive. */
export async function readArpNeighbors(): Promise<Map<string, string>> {
  const found = new Map<string, string>();

  try {
    const { stdout } = await execFileAsync("ip", ["neigh", "show"], { timeout: 2000 });
    for (const line of stdout.split("\n")) {
      const match = line.match(
        /^(\d+\.\d+\.\d+\.\d+)\s+.*\slladdr\s+([0-9a-f:]+)\s+(REACHABLE|STALE|DELAY|PROBE|PERMANENT)/i,
      );
      if (match) found.set(match[1], match[2].toLowerCase());
    }
    if (found.size > 0) return found;
  } catch {
    // Fall through to /proc/net/arp
  }

  try {
    const table = await readFile("/proc/net/arp", "utf8");
    for (const line of table.split("\n").slice(1)) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 4) continue;
      const [ip, , , mac] = parts;
      if (!isValidIpv4(ip) || mac === "00:00:00:00:00:00") continue;
      found.set(ip, mac.toLowerCase());
    }
  } catch {
    // Ignore
  }

  return found;
}

export async function isIpPresent(ip: string): Promise<{ present: boolean; mac?: string }> {
  const trimmed = ip.trim();
  if (!isValidIpv4(trimmed)) {
    throw new Error("Enter a valid IPv4 address");
  }

  const neighbors = await readArpNeighbors();
  const cachedMac = neighbors.get(trimmed);
  if (cachedMac) {
    return { present: true, mac: cachedMac };
  }

  const alive = await pingHost(trimmed);
  if (!alive) return { present: false };

  const refreshed = await readArpNeighbors();
  return { present: true, mac: refreshed.get(trimmed) };
}

export interface NetworkNode {
  ip: string;
  mac?: string;
}

async function mapPool<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;

  async function run() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index]);
    }
  }

  const runners = Array.from({ length: Math.min(concurrency, items.length) }, () => run());
  await Promise.all(runners);
  return results;
}

/** Discover live hosts on the local subnet (ARP cache + ping sweep). */
export async function scanLocalNodes(options?: {
  subnet?: LocalSubnet | null;
  concurrency?: number;
}): Promise<{ subnet: string; nodes: NetworkNode[] }> {
  const subnet = options?.subnet === undefined ? detectLocalSubnet() : options.subnet;
  if (!subnet) {
    throw new Error("Could not detect a local network interface");
  }

  // Cap very wide subnets so rules stay responsive.
  const prefix = Math.max(subnet.prefix, 24);
  const scanSubnet = prefix === subnet.prefix ? subnet : { ...subnet, prefix };
  const candidates = hostsForSubnet(scanSubnet, 254);
  const neighbors = await readArpNeighbors();
  const nodes = new Map<string, NetworkNode>();

  for (const [ip, mac] of neighbors) {
    if (candidates.includes(ip) || ip === subnet.address) {
      nodes.set(ip, { ip, mac });
    }
  }

  const missing = candidates.filter((ip) => !nodes.has(ip));
  const checks = await mapPool(missing, options?.concurrency ?? 48, async (ip) => {
    const alive = await pingHost(ip, 500);
    return alive ? ip : null;
  });

  for (const ip of checks) {
    if (ip) nodes.set(ip, { ip });
  }

  const refreshed = await readArpNeighbors();
  for (const node of nodes.values()) {
    const mac = refreshed.get(node.ip);
    if (mac) node.mac = mac;
  }

  const sorted = [...nodes.values()].sort((a, b) => ipv4ToInt(a.ip) - ipv4ToInt(b.ip));
  return { subnet: `${subnet.address}/${subnet.prefix}`, nodes: sorted };
}

export function formatNodeList(nodes: NetworkNode[]): string {
  return nodes.map((node) => (node.mac ? `${node.ip} (${node.mac})` : node.ip)).join("\n");
}
