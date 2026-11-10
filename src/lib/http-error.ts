import type { ErrorStatus } from "../site-map.js";

/** An error that maps to one of the error pages. Anything else becomes a 500. */
export class HttpError extends Error {
  readonly status: ErrorStatus;

  constructor(status: ErrorStatus, message = `HTTP ${status}`) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}
