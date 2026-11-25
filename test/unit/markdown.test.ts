import * as cheerio from "cheerio";
import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../../src/lib/markdown.js";

// Every value here is invented. The sanitiser tests check the parsed output,
// not just its text, so an unsafe element or attribute can't hide in markup
// that happens to look different.

function render(markdown: string): { html: string; $: cheerio.CheerioAPI } {
  const { html } = renderMarkdown(markdown);
  return { html, $: cheerio.load(html, null, false) };
}

const FORBIDDEN_ELEMENTS = [
  "script",
  "style",
  "iframe",
  "frame",
  "frameset",
  "object",
  "embed",
  "applet",
  "form",
  "input",
  "button",
  "textarea",
  "select",
  "svg",
  "math",
  "base",
  "link",
  "meta",
  "template",
  "noscript",
];

const SAFE_URL = /^(https?:|mailto:|\/|#|[^:]*$)/i;

/** Fails if the output has anything that could run script or change the page around it. */
function expectSafe(html: string): void {
  const $ = cheerio.load(html, null, false);
  for (const name of FORBIDDEN_ELEMENTS) {
    expect($(name), `<${name}> elements`).toHaveLength(0);
  }
  expect(html).not.toContain("<!--");
  $("*").each((_, element) => {
    if (!("attribs" in element)) return;
    for (const [name, value] of Object.entries(element.attribs)) {
      expect(name.startsWith("on"), `attribute ${name}`).toBe(false);
      expect(name, `attribute ${name}`).not.toBe("style");
      if (name === "href" || name === "src") {
        expect(value.replace(/[\s\u0000-\u001f]/g, ""), `${name}="${value}"`).toMatch(SAFE_URL);
      }
    }
  });
}

describe("renderMarkdown", () => {
  describe("what it makes safe", () => {
    it.each([
      ["a script element", "Hello\n\n<script>alert(1)</script>"],
      ["a script element in mixed case", "<ScRiPt>alert(1)</sCrIpT>"],
      ["a script element with an unclosed tag", "<script src=//example.invalid/x.js"],
      ["an image with an error handler", '<img src="x" onerror="alert(1)">'],
      ["an image with an unquoted error handler", "<img src=x onerror=alert(1)>"],
      ["a link with a click handler", '<a href="/ok" onclick="alert(1)">link</a>'],
      ["an element with a mouse handler", '<p onmouseover="alert(1)">hover</p>'],
      ["a style attribute", '<p style="position:fixed;top:0;left:0">cover the page</p>'],
      ["a style element", "<style>body { display: none }</style>text"],
      ["an iframe", '<iframe src="https://example.invalid/"></iframe>'],
      ["an object", '<object data="https://example.invalid/x.swf"></object>'],
      ["an embed", '<embed src="https://example.invalid/x.swf">'],
      ["a form", '<form action="https://example.invalid/"><input name="a"></form>'],
      ["an input", '<input type="text" autofocus onfocus="alert(1)">'],
      ["an svg with a script", "<svg><script>alert(1)</script></svg>"],
      ["an svg with a load handler", '<svg onload="alert(1)"></svg>'],
      ["a math element", "<math><mi>x</mi></math>"],
      ["a base element", '<base href="https://example.invalid/">'],
      ["a meta refresh", '<meta http-equiv="refresh" content="0;url=https://example.invalid/">'],
      ["an html comment", "before <!-- hidden --> after"],
      ["a conditional comment", "<!--[if IE]><script>alert(1)</script><![endif]-->"],
      ["a nested malformed tag", "<<script>script>alert(1)<</script>/script>"],
      ["a tag split across lines", "<scr\nipt>alert(1)</scr\nipt>"],
      ["a template element", "<template><script>alert(1)</script></template>"],
      ["a noscript trick", '<noscript><p title="</noscript><img src=x onerror=alert(1)>">'],
    ])("removes %s", (_name, markdown) => {
      expectSafe(render(markdown).html);
    });

    it.each([
      ["javascript:", "javascript:alert(1)"],
      ["javascript: in mixed case", "JaVaScRiPt:alert(1)"],
      ["javascript: with leading space", " javascript:alert(1)"],
      ["javascript: with a tab inside", "java\tscript:alert(1)"],
      ["javascript: with an encoded letter", "&#106;avascript:alert(1)"],
      ["javascript: with a hex encoded letter", "&#x6A;avascript:alert(1)"],
      ["javascript: with an encoded colon", "javascript&colon;alert(1)"],
      ["vbscript:", "vbscript:msgbox(1)"],
      ["data: html", "data:text/html,<script>alert(1)</script>"],
      ["data: html in base64", "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=="],
      ["file:", "file:///etc/passwd"],
    ])("removes a link address using %s", (_name, address) => {
      expectSafe(render(`<a href="${address}">click</a>`).html);
      // Markdown can't hold a space in an address, and a percent-encoded one is a relative address.
      if (!/\s/.test(address)) expectSafe(render(`[click](${address})`).html);
      const { $ } = render(`<a href="${address}">click</a>`);
      expect($("a[href]")).toHaveLength(0);
      expect($("p").text()).toContain("click");
    });

    it.each([
      ["javascript:", "javascript:alert(1)"],
      ["data: html", "data:text/html,<script>alert(1)</script>"],
      ["vbscript:", "vbscript:msgbox(1)"],
      ["a plain http address", "http://example.invalid/a.png"],
      ["a protocol-relative address", "//example.invalid/a.png"],
    ])("removes an image source using %s", (_name, source) => {
      const { $, html } = render(`<img src="${source}" alt="a picture">`);

      expectSafe(html);
      expect($("img[src]")).toHaveLength(0);
    });

    it("removes the same unsafe addresses from markdown links and images", () => {
      const { html } = render("[a](javascript:alert(1)) ![b](javascript:alert(1)) ![c](data:x)");

      expectSafe(html);
      expect(html).not.toContain("javascript:");
    });

    it("keeps the text of an unsafe element's allowed children", () => {
      const { $ } = render("<form><p>Keep this</p></form>");

      expect($("form")).toHaveLength(0);
      expect($("p").text()).toBe("Keep this");
    });

    it("drops the author's class and id attributes, so content can't fake GOV.UK styles or clobber the page", () => {
      const { $ } = render(
        '<p class="govuk-error-summary" id="main-content">text</p>\n\n<h2 class="govuk-visually-hidden" id="skip-link">Heading</h2>',
      );

      expect($("p").attr("id")).toBeUndefined();
      expect($("p").attr("class")).toBe("govuk-body");
      expect($("h2").attr("id")).toBe("heading");
      expect($("h2").attr("class")).not.toContain("govuk-visually-hidden");
    });

    it("keeps phone links", () => {
      const { $ } = render('<a href="tel:+441234567890">Call us</a>');

      expect($("a").attr("href")).toBe("tel:+441234567890");
    });

    it("turns a link whose address was removed into plain text, not a dead link", () => {
      const { $ } = render('<a href="javascript:alert(1)">click</a> and [x](vbscript:y)');

      expect($("a")).toHaveLength(0);
      expect($("p").text()).toBe("click and x");
    });

    it("removes an image whose source was removed", () => {
      const { $ } = render('<img src="http://example.invalid/a.png" alt="A picture"> ![b](data:x)');

      expect($("img")).toHaveLength(0);
    });

    it("removes a heading with no text, so it can't leave an empty link in the contents", () => {
      const { $ } = render('<h2></h2>\n\n<h2><a href="/x">  </a></h2>\n\n## Real');

      expect($("h2")).toHaveLength(1);
      expect(renderMarkdown("<h2></h2>\n\n## Real").headings).toEqual([
        { id: "real", text: "Real" },
      ]);
    });

    it("keeps escaped markup as visible text", () => {
      const { $ } = render("&lt;script&gt;alert(1)&lt;/script&gt;");

      expect($("script")).toHaveLength(0);
      expect($("p").text()).toBe("<script>alert(1)</script>");
    });

    it("escapes markup in code", () => {
      const { $ } = render("```html\n<script>alert(1)</script>\n```\n\n`<img onerror=x>`");

      expect($("script")).toHaveLength(0);
      expect($("img")).toHaveLength(0);
      expect($("pre code").text()).toContain("<script>alert(1)</script>");
      expect($("p code").text()).toBe("<img onerror=x>");
    });

    it("does not let a markdown title break out of the attribute", () => {
      const { html } = render('[a](/ok "x\\" onmouseover=\\"alert(1)")');

      expectSafe(html);
    });

    it("gives empty output for empty input", () => {
      expect(renderMarkdown("").html).toBe("");
      expect(renderMarkdown("   \n\n").headings).toEqual([]);
    });
  });

  describe("what it keeps", () => {
    it("keeps links to http, https, mailto and relative addresses", () => {
      const { $ } = render(
        "[a](http://example.com/a) [b](https://example.com/b) [c](mailto:someone@example.com) [d](/tools/atlas-maker) [e](#scope) [f](../other)",
      );

      expect(
        $("a")
          .map((_, a) => $(a).attr("href"))
          .get(),
      ).toEqual([
        "http://example.com/a",
        "https://example.com/b",
        "mailto:someone@example.com",
        "/tools/atlas-maker",
        "#scope",
        "../other",
      ]);
    });

    it("keeps images with relative or https sources, and their alt text", () => {
      const { $ } = render(
        "![A diagram](/images/diagram.png) ![Remote](https://example.com/a.png)",
      );

      expect(
        $("img")
          .map((_, img) => $(img).attr("src"))
          .get(),
      ).toEqual(["/images/diagram.png", "https://example.com/a.png"]);
      expect($("img").first().attr("alt")).toBe("A diagram");
    });

    it("keeps the number an ordered list starts at", () => {
      const { $ } = render('4. four\n5. five\n\n<ol start="7"><li>seven</li></ol>');

      expect(
        $("ol")
          .map((_, ol) => $(ol).attr("start"))
          .get(),
      ).toEqual(["4", "7"]);
    });

    it("leaves out a list start that isn't a whole number", () => {
      const { $ } = render(
        '<ol start="javascript:alert(1)"><li>a</li></ol><ol start="-3"><li>b</li></ol><ol start="1e9"><li>c</li></ol><ol start="99999999999"><li>d</li></ol>',
      );

      expect($("ol[start]")).toHaveLength(0);
    });

    it("keeps tables, including ones written as HTML", () => {
      const { $ } = render(
        "| Name | Value |\n| --- | --- |\n| One | 1 |\n\n<table><thead><tr><th>A</th></tr></thead><tbody><tr><td>b</td></tr></tbody></table>",
      );

      expect($("table")).toHaveLength(2);
      expect($("th").first().text()).toBe("Name");
      expect($("td").last().text()).toBe("b");
    });

    it("marks the header cells of a markdown table as column headers", () => {
      const { $ } = render("| A | B |\n| --- | --- |\n| c | d |");

      expect(
        $("th")
          .map((_, th) => $(th).attr("scope"))
          .get(),
      ).toEqual(["col", "col"]);
    });

    it("keeps the scope of table headers", () => {
      const { $ } = render(
        '<table><tr><th scope="col">A</th><th scope="colgroup" colspan="2">B</th></tr><tr><th scope="row">r</th><th scope="rowgroup">g</th><td>x</td></tr></table>',
      );

      expect(
        $("th")
          .map((_, th) => $(th).attr("scope"))
          .get(),
      ).toEqual(["col", "colgroup", "row", "rowgroup"]);
      expect($("th[colspan]").attr("colspan")).toBe("2");
    });

    it("leaves out a header scope that isn't one of the four", () => {
      const { $ } = render(
        '<table><tr><th scope="javascript:alert(1)">A</th><td scope="row">b</td></tr></table>',
      );

      expect($("[scope]")).toHaveLength(0);
    });

    it("keeps definition lists, captions, details, strikethrough and small inline markup", () => {
      const { $ } = render(
        "<dl><dt>Term</dt><dd>Meaning</dd></dl>\n\n<table><caption>Sizes</caption><tr><td>a</td></tr></table>\n\n<details><summary>More</summary><p>Hidden</p></details>\n\n~~old~~ H<sub>2</sub>O x<sup>2</sup> <kbd>Ctrl</kbd>",
      );

      expect($("dl dt").text()).toBe("Term");
      expect($("dl dd").text()).toBe("Meaning");
      expect($("caption").text()).toBe("Sizes");
      expect($("details summary").text()).toBe("More");
      expect($("del").text()).toBe("old");
      expect($("sub").text()).toBe("2");
      expect($("sup").text()).toBe("2");
      expect($("kbd").text()).toBe("Ctrl");
    });

    it("keeps lists, code blocks, quotes, rules and emphasis", () => {
      const { $ } = render(
        "- one\n- two\n\n1. first\n2. second\n\n> quoted\n\n---\n\n**bold** and *italic*\n\n```\ncode\n```",
      );

      expect($("ul li")).toHaveLength(2);
      expect($("ol li")).toHaveLength(2);
      expect($("blockquote").text().trim()).toBe("quoted");
      expect($("hr")).toHaveLength(1);
      expect($("strong").text()).toBe("bold");
      expect($("em").text()).toBe("italic");
      expect($("pre code").text()).toContain("code");
    });
  });

  describe("GOV.UK classes", () => {
    it("adds them to paragraphs, headings, lists, links and tables", () => {
      const { $ } = render(
        [
          "## Two",
          "### Three",
          "A paragraph with a [link](/a).",
          "- bullet",
          "1. number",
          "| A | B |\n| --- | --- |\n| c | d |",
        ].join("\n\n"),
      );

      expect($("h2").attr("class")).toBe("govuk-heading-m");
      expect($("h3").attr("class")).toBe("govuk-heading-s");
      expect($("p").first().attr("class")).toBe("govuk-body");
      expect($("ul").attr("class")).toBe("govuk-list govuk-list--bullet");
      expect($("ol").attr("class")).toBe("govuk-list govuk-list--number");
      expect($("a").attr("class")).toBe("govuk-link");
      expect($("table").attr("class")).toBe("govuk-table");
      expect($("thead").attr("class")).toBe("govuk-table__head");
      expect($("tbody").attr("class")).toBe("govuk-table__body");
      expect($("tr").first().attr("class")).toBe("govuk-table__row");
      expect($("th").first().attr("class")).toBe("govuk-table__header");
      expect($("td").first().attr("class")).toBe("govuk-table__cell");
    });

    it("adds them to elements written as HTML too", () => {
      const { $ } = render('<p>Hello <a href="/a">there</a></p>');

      expect($("p").attr("class")).toBe("govuk-body");
      expect($("a").attr("class")).toBe("govuk-link");
    });
  });

  describe("headings", () => {
    it("gives h2 and h3 headings ids made from their text", () => {
      const { $ } = render("## Set up\n\n### What you need\n\n## Who to ask (and when)");

      expect(
        $("h2")
          .map((_, h) => $(h).attr("id"))
          .get(),
      ).toEqual(["set-up", "who-to-ask-and-when"]);
      expect($("h3").attr("id")).toBe("what-you-need");
    });

    it("numbers the ids of headings with the same text", () => {
      const { $ } = render("## Scope\n\n## Scope\n\n## Scope");

      expect(
        $("h2")
          .map((_, h) => $(h).attr("id"))
          .get(),
      ).toEqual(["scope", "scope-2", "scope-3"]);
    });

    it("gives h4 to h6 headings ids too, so links to them work", () => {
      const { $ } = render("#### Limits\n\n##### Small print\n\n###### Notes\n\n[Limits](#limits)");

      expect($("h4").attr("id")).toBe("limits");
      expect($("h5").attr("id")).toBe("small-print");
      expect($("h6").attr("id")).toBe("notes");
      expect(renderMarkdown("#### Limits").headings).toEqual([]);
    });

    it("numbers ids across heading levels", () => {
      const { $ } = render("## Limits\n\n#### Limits");

      expect($("h2").attr("id")).toBe("limits");
      expect($("h4").attr("id")).toBe("limits-2");
    });

    it("leaves apostrophes out of ids", () => {
      const { headings } = renderMarkdown("## What's new\n\n## Who\u2019s who");

      expect(headings.map((heading) => heading.id)).toEqual(["whats-new", "whos-who"]);
    });

    it("makes a heading in the body an h2, as the page has its own h1", () => {
      const { $ } = render("# Title\n\n<h1>Another</h1>\n\nText");

      expect($("h1")).toHaveLength(0);
      expect($("h2.govuk-heading-m")).toHaveLength(2);
    });

    it("lists the h2 headings, with their ids, for the on-page contents", () => {
      const { headings } = renderMarkdown("## Set up\n\n### Not listed\n\n## Scope\n\n## Scope");

      expect(headings).toEqual([
        { id: "set-up", text: "Set up" },
        { id: "scope", text: "Scope" },
        { id: "scope-2", text: "Scope" },
      ]);
    });

    it("gives plain text for a heading with formatting or markup in it", () => {
      const { headings } = renderMarkdown("## Use `npm` **now** <script>alert(1)</script>");

      expect(headings).toHaveLength(1);
      expect(headings[0]?.text).toBe("Use npm now");
      expect(headings[0]?.id).toBe("use-npm-now");
    });

    it("gives a usable id to a heading with no letters or digits", () => {
      const { headings } = renderMarkdown("## ???");

      expect(headings[0]?.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    });

    it("lists no headings when there are none", () => {
      expect(renderMarkdown("Just text.").headings).toEqual([]);
    });
  });
});
