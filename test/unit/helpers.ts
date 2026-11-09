import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import type { Express } from "express";
import type { Config } from "../../src/config.js";

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

/** Starts the app on a random port so tests can make real HTTP requests. */
export async function startApp(app: Express): Promise<RunningApp> {
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => {
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
