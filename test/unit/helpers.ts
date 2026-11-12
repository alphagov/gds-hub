import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import type { Express } from "express";
import type { Config } from "../../src/config.js";
import type { RedirectService } from "../../src/services/redirects/redirect-service.js";

export const testConfig: Config = Object.freeze({
  nodeEnv: "test",
  port: 0,
  logLevel: "error",
  version: "1.2.3-test",
  databaseUrl: "postgres://user:pass@localhost:5432/test",
});

export interface RunningApp {
  baseUrl: string;
  close: () => Promise<void>;
}

/**
 * Starts the app on a random port so tests can make real HTTP requests. It
 * listens on 127.0.0.1 only, the address the tests fetch. A server listening
 * on every interface can be given the same port as another test process's
 * 127.0.0.1 server (migrate:verify starts one), which would then receive
 * this test's requests.
 */
export async function startApp(app: Express): Promise<RunningApp> {
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => {
      resolve(s);
    });
  });
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      }),
  };
}

/** A redirect service with no redirects, for tests that aren't about them. */
export const noRedirects: RedirectService = Object.freeze({
  newPathFor: () => Promise.resolve(undefined),
});
