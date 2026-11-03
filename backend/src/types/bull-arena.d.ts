declare module "bull-arena" {
  import type { RequestHandler } from "express";

  interface ArenaQueueConfig {
    name: string;
    hostId: string;
    type?: "bee" | "bull" | "bullmq";
    prefix?: string;
    redis?: {
      host?: string;
      port?: number;
      password?: string;
    };
  }

  interface ArenaConfig {
    Bee?: unknown;
    Bull?: unknown;
    BullMQ?: unknown;
    queues: ArenaQueueConfig[];
    activeHostId?: string;
  }

  interface ArenaListenOpts {
    basePath?: string;
    disableListen?: boolean;
    useCdn?: boolean;
    port?: number;
    host?: string;
  }

  export default function Arena(config: ArenaConfig, listenOpts?: ArenaListenOpts): RequestHandler;
}
