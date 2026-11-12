import { describe, expect, it } from "vitest";
import { createLoadReport, newRunId } from "../../../src/migration/load-report.js";
import type { LoadOutcome } from "../../../src/migration/loader.js";
import { REPORT_KIND } from "../../../src/migration/report.js";
import { systemActor } from "../../../src/services/audit/actor.js";

const NOW = new Date("2026-11-12T10:15:00.000Z");

function outcome(overrides: Partial<LoadOutcome> = {}): LoadOutcome {
  return {
    runId: "migration-20261112T101500Z-a1b2c3",
    applied: true,
    records: [
      { entity: "tool", key: "kettle-board", action: "create", changedFields: [] },
      { entity: "tool", key: "lanternly", action: "update", changedFields: ["description"] },
      { entity: "tool", key: "quillstack", action: "unchanged", changedFields: [] },
      { entity: "page", key: "device-policy", action: "create", changedFields: [] },
      { entity: "redirect", key: "/old-widgets.html", action: "unchanged", changedFields: [] },
    ],
    links: [
      { table: "capability_tool", added: 3, removed: 0, updated: 0, unchanged: 0 },
      { table: "product_team_service_instance", added: 2, removed: 0, updated: 0, unchanged: 0 },
      {
        table: "business_unit_product_team_service",
        added: 0,
        removed: 1,
        updated: 0,
        unchanged: 1,
      },
    ],
    onlyInDatabase: [],
    ...overrides,
  };
}

describe("the load report", () => {
  it("is marked as a migration report, with its run and whether it was applied", () => {
    const report = createLoadReport(outcome({ applied: false }), NOW);
    expect(report).toMatchObject({
      kind: REPORT_KIND,
      report: "load",
      createdAt: NOW.toISOString(),
      runId: "migration-20261112T101500Z-a1b2c3",
      applied: false,
    });
  });

  it("counts what happened to the records of each kind of input", () => {
    const report = createLoadReport(outcome(), NOW);
    expect(report.summary.find((row) => row.group === "yaml")).toEqual({
      group: "yaml",
      records: 3,
      created: 1,
      updated: 1,
      unchanged: 1,
      skipped: 0,
    });
    expect(report.summary.find((row) => row.group === "content")).toMatchObject({
      records: 1,
      created: 1,
    });
    expect(report.summary.find((row) => row.group === "redirect")).toMatchObject({
      records: 1,
      unchanged: 1,
    });
  });

  it("counts each type of record", () => {
    const report = createLoadReport(outcome(), NOW);
    expect(report.entities.tool).toEqual({ created: 1, updated: 1, unchanged: 1, skipped: 0 });
    expect(report.entities.contract).toEqual({ created: 0, updated: 0, unchanged: 0, skipped: 0 });
  });

  it("lists each record that changed, naming the fields but never their values", () => {
    const report = createLoadReport(outcome(), NOW);
    expect(report.changes).toEqual([
      { entity: "tool", key: "kettle-board", action: "create", changedFields: [] },
      { entity: "tool", key: "lanternly", action: "update", changedFields: ["description"] },
      { entity: "page", key: "device-policy", action: "create", changedFields: [] },
    ]);
  });

  it("includes the links that were added, removed or changed", () => {
    expect(createLoadReport(outcome(), NOW).links).toEqual(outcome().links);
  });

  it("passes when nothing needed to be skipped", () => {
    expect(createLoadReport(outcome(), NOW).passed).toBe(true);
  });

  it("fails, listing them, when records changed by an editor were skipped", () => {
    const report = createLoadReport(
      outcome({
        records: [
          {
            entity: "tool",
            key: "quillstack",
            action: "skipped",
            changedFields: [],
            reason: "an editor has changed it since the migration last wrote it",
          },
        ],
      }),
      NOW,
    );
    expect(report.passed).toBe(false);
    expect(report.skipped).toEqual([
      {
        entity: "tool",
        key: "quillstack",
        reason: "an editor has changed it since the migration last wrote it",
      },
    ]);
  });

  it("lists records only in the database, without failing", () => {
    const report = createLoadReport(
      outcome({ onlyInDatabase: [{ entity: "tool", key: "hand-made-tool" }] }),
      NOW,
    );
    expect(report.onlyInDatabase).toEqual([{ entity: "tool", key: "hand-made-tool" }]);
    expect(report.passed).toBe(true);
  });
});

describe("a migration run's ID", () => {
  it("says when the run started and can be recorded as the audit request ID", () => {
    const runId = newRunId(NOW);
    expect(runId).toMatch(/^migration-20261112T101500Z-[0-9a-f]{6}$/);
    expect(() => systemActor("data_migration", { requestId: runId })).not.toThrow();
  });

  it("is different for two runs started at the same time", () => {
    expect(newRunId(NOW)).not.toBe(newRunId(NOW));
  });
});
