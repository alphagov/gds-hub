import { describe, expect, it } from "vitest";
import { changedFields, valuesEqual } from "../../src/services/audit/changes.js";

describe("valuesEqual", () => {
  it("treats equal text, numbers and booleans as equal", () => {
    expect(valuesEqual("a", "a")).toBe(true);
    expect(valuesEqual(1, 1)).toBe(true);
    expect(valuesEqual(false, false)).toBe(true);
  });

  it("treats different values as different", () => {
    expect(valuesEqual("a", "b")).toBe(false);
    expect(valuesEqual(true, false)).toBe(false);
  });

  it("distinguishes a number from the same number as text", () => {
    expect(valuesEqual(1, "1")).toBe(false);
  });

  it("treats null and a missing value as equal", () => {
    expect(valuesEqual(null, undefined)).toBe(true);
    expect(valuesEqual(null, null)).toBe(true);
  });

  it("treats null and an empty string as different", () => {
    expect(valuesEqual(null, "")).toBe(false);
  });

  it("compares dates by the time they hold", () => {
    expect(
      valuesEqual(new Date("2026-11-11T10:00:00.000Z"), new Date("2026-11-11T10:00:00.000Z")),
    ).toBe(true);
    expect(
      valuesEqual(new Date("2026-11-11T10:00:00.000Z"), new Date("2026-11-11T10:00:00.001Z")),
    ).toBe(false);
  });

  it("compares objects regardless of the order of their keys", () => {
    expect(valuesEqual({ a: "1", b: "2" }, { b: "2", a: "1" })).toBe(true);
  });

  it("treats objects with different keys or values as different", () => {
    expect(valuesEqual({ a: "1" }, { a: "1", b: "2" })).toBe(false);
    expect(valuesEqual({ a: "1" }, { a: "2" })).toBe(false);
  });

  it("compares nested objects and arrays", () => {
    expect(valuesEqual({ a: { b: ["x", "y"] } }, { a: { b: ["x", "y"] } })).toBe(true);
    expect(valuesEqual({ a: { b: ["x", "y"] } }, { a: { b: ["x", "z"] } })).toBe(false);
  });

  it("treats arrays with the same items in a different order as different", () => {
    expect(valuesEqual(["a", "b"], ["a", "b"])).toBe(true);
    expect(valuesEqual(["a", "b"], ["b", "a"])).toBe(false);
    expect(valuesEqual(["a"], ["a", "b"])).toBe(false);
  });

  it("treats an array and an object as different", () => {
    expect(valuesEqual([], {})).toBe(false);
  });
});

describe("changedFields", () => {
  it("lists only the fields whose values differ", () => {
    expect(
      changedFields(
        { name: "Old", url: "https://example.com" },
        { name: "New", url: "https://example.com" },
      ),
    ).toEqual(["name"]);
  });

  it("returns an empty list when nothing differs", () => {
    expect(changedFields({ name: "Same", tags: ["a"] }, { name: "Same", tags: ["a"] })).toEqual([]);
  });

  it("leaves out the fields it is told to ignore", () => {
    expect(
      changedFields(
        { name: "Old", updatedAt: new Date("2026-01-01T00:00:00Z") },
        { name: "New", updatedAt: new Date("2026-11-11T00:00:00Z") },
        ["updatedAt"],
      ),
    ).toEqual(["name"]);
  });

  it("includes a field that is only in one of the records", () => {
    expect(changedFields({ name: "A" }, { name: "A", description: "Added" })).toEqual([
      "description",
    ]);
    expect(changedFields({ name: "A", description: "Removed" }, { name: "A" })).toEqual([
      "description",
    ]);
  });

  it("lists the fields in the order they appear in the record after the change", () => {
    expect(changedFields({ a: 1, b: 1, c: 1 }, { c: 2, a: 2, b: 1 })).toEqual(["c", "a"]);
  });
});
