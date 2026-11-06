import type { Logger } from "../lib/logger.js";

declare global {
  namespace Express {
    interface Locals {
      requestId: string;
      logger: Logger;
    }
  }
}

export {};
