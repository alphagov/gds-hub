import { describe, expect, it } from "vitest";
import {
  compareByWeightThenName,
  groupCapabilitiesForNavigation,
  type NavigableCapability,
} from "../../src/services/catalogue/ordering.js";

let nextId = 1;

function capability(
  name: string,
  groupName: string | null,
  options: { weight?: number; hidden?: boolean; id?: number } = {},
): NavigableCapability {
  return {
    id: options.id ?? nextId++,
    name,
    groupName,
    weight: options.weight ?? null,
    hideInNavigation: options.hidden ?? false,
  };
}

type Groups = ReturnType<typeof groupCapabilitiesForNavigation>;

function names(groups: Groups): [string | null, string[]][] {
  return groups.map((group) => [group.name, group.capabilities.map((entry) => entry.name)]);
}

describe("compareByWeightThenName", () => {
  it("puts lower weights first", () => {
    const sorted = [
      capability("Heavy", null, { weight: 5 }),
      capability("Light", null, { weight: -1 }),
      capability("Middle", null, { weight: 0 }),
    ].sort(compareByWeightThenName);

    expect(sorted.map((entry) => entry.name)).toEqual(["Light", "Middle", "Heavy"]);
  });

  it("puts records with no weight after those with one", () => {
    const sorted = [capability("Alpha", null), capability("Zulu", null, { weight: 100 })].sort(
      compareByWeightThenName,
    );

    expect(sorted.map((entry) => entry.name)).toEqual(["Zulu", "Alpha"]);
  });

  it("orders records with the same weight by name, then by id", () => {
    const sorted = [
      capability("Bravo", null, { weight: 1, id: 20 }),
      capability("Bravo", null, { weight: 1, id: 10 }),
      capability("alpha", null, { weight: 1, id: 30 }),
    ].sort(compareByWeightThenName);

    expect(sorted.map((entry) => [entry.name, entry.id])).toEqual([
      ["alpha", 30],
      ["Bravo", 10],
      ["Bravo", 20],
    ]);
  });
});

describe("groupCapabilitiesForNavigation", () => {
  it("leaves out capabilities that are hidden from navigation", () => {
    const groups = groupCapabilitiesForNavigation([
      capability("Shown", "Delivery"),
      capability("Hidden", "Delivery", { hidden: true }),
    ]);

    expect(names(groups)).toEqual([["Delivery", ["Shown"]]]);
  });

  it("leaves out a group whose capabilities are all hidden", () => {
    const groups = groupCapabilitiesForNavigation([
      capability("Shown", "Delivery"),
      capability("Hidden", "Security", { hidden: true }),
    ]);

    expect(names(groups)).toEqual([["Delivery", ["Shown"]]]);
  });

  it("orders capabilities in a group by weight, then name", () => {
    const groups = groupCapabilitiesForNavigation([
      capability("Apples", "Fruit"),
      capability("Cherries", "Fruit", { weight: 2 }),
      capability("Bananas", "Fruit", { weight: 1 }),
    ]);

    expect(names(groups)).toEqual([["Fruit", ["Bananas", "Cherries", "Apples"]]]);
  });

  it("orders groups by their lowest-weighted capability", () => {
    const groups = groupCapabilitiesForNavigation([
      capability("Monitoring", "Operations", { weight: 30 }),
      capability("Builds", "Delivery", { weight: 10 }),
      capability("Scanning", "Security", { weight: 20 }),
      capability("Deploys", "Delivery", { weight: 40 }),
    ]);

    expect(names(groups)).toEqual([
      ["Delivery", ["Builds", "Deploys"]],
      ["Security", ["Scanning"]],
      ["Operations", ["Monitoring"]],
    ]);
  });

  it("orders groups with no weights by name, after groups with weights", () => {
    const groups = groupCapabilitiesForNavigation([
      capability("Zebra crossings", "Roads"),
      capability("Harbours", "Ports"),
      capability("Timetables", "Trains", { weight: 5 }),
    ]);

    expect(names(groups).map(([name]) => name)).toEqual(["Trains", "Ports", "Roads"]);
  });

  it("puts capabilities with no group last, whatever their weight", () => {
    const groups = groupCapabilitiesForNavigation([
      capability("Loose end", null, { weight: 0 }),
      capability("Blank group", "   "),
      capability("Grouped", "Delivery", { weight: 50 }),
    ]);

    expect(names(groups)).toEqual([
      ["Delivery", ["Grouped"]],
      [null, ["Loose end", "Blank group"]],
    ]);
  });

  it("treats group names that differ only in surrounding spaces as one group", () => {
    const groups = groupCapabilitiesForNavigation([
      capability("One", "Delivery"),
      capability("Two", " Delivery "),
    ]);

    expect(names(groups)).toEqual([["Delivery", ["One", "Two"]]]);
  });

  it("does not change the list it is given", () => {
    const input = [
      capability("Second", "Group", { weight: 2 }),
      capability("First", "Group", { weight: 1 }),
    ];

    groupCapabilitiesForNavigation(input);

    expect(input.map((entry) => entry.name)).toEqual(["Second", "First"]);
  });

  it("gives no groups when there are no capabilities", () => {
    expect(groupCapabilitiesForNavigation([])).toEqual([]);
  });
});
