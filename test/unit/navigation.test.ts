import { describe, expect, it } from "vitest";
import { serviceNavigation, type NavigationItem } from "../../src/lib/navigation.js";
import { HOME_PATH, SECTION_LIST, SECTIONS } from "../../src/site-map.js";

function itemFor(path: string, name: string): NavigationItem {
  const item = serviceNavigation(path).find((entry) => entry.text === name);
  if (!item) throw new Error(`no navigation item called ${name}`);
  return item;
}

const { tools, policies } = SECTIONS;

describe("serviceNavigation", () => {
  it("lists every section in order", () => {
    const listed = serviceNavigation(HOME_PATH).map(({ text, href }) => ({ text, href }));

    expect(listed).toEqual(SECTION_LIST.map(({ name, path }) => ({ text: name, href: path })));
    expect(listed).toHaveLength(6);
  });

  it("marks nothing on the home page", () => {
    for (const item of serviceNavigation(HOME_PATH)) {
      expect(item.current).toBe(false);
      expect(item.active).toBe(false);
    }
  });

  it("marks the section as current on its own page", () => {
    expect(itemFor(tools.path, tools.name)).toMatchObject({ current: true, active: false });
    expect(itemFor(`${tools.path}/`, tools.name)).toMatchObject({ current: true, active: false });
  });

  it("marks the section as active on a page inside it", () => {
    const item = itemFor(`${tools.path}/example`, tools.name);

    expect(item).toMatchObject({ current: false, active: true });
  });

  it("only marks one item at a time", () => {
    const marked = serviceNavigation(`${policies.path}/example`).filter(
      (item) => item.current || item.active,
    );

    expect(marked.map((item) => item.text)).toEqual([policies.name]);
  });

  it("does not treat a path that only starts with the same letters as inside the section", () => {
    const item = itemFor(`${tools.path}mith`, tools.name);

    expect(item).toMatchObject({ current: false, active: false });
  });
});
