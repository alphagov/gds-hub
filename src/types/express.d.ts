import type { EditorIdentity } from "../editing/editor-identity.js";
import type { Logger } from "../lib/logger.js";

declare global {
  namespace Express {
    interface Locals {
      requestId: string;
      logger: Logger;
      /** Per-request nonce allowed by the Content-Security-Policy script-src. */
      cspNonce: string;
      /** Who is editing. Set by requireEditor on /edit/* routes only. */
      editor?: EditorIdentity;
    }
  }
}

export {};
