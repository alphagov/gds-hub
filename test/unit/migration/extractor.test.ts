import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_STRIP_SELECTORS } from "../../../src/migration/config.js";
import {
  extractContent,
  redirectTarget,
  type ExtractOptions,
} from "../../../src/migration/extractor.js";
import { FIXTURE_BUILD_DIR, builtPage } from "./helpers.js";

function options(overrides: Partial<ExtractOptions> = {}): ExtractOptions {
  return {
    contentSelector: "main",
    stripSelectors: DEFAULT_STRIP_SELECTORS,
    link: {
      pagePath: "/engineering/widgets/",
      siteOrigins: ["https://hub.example.com"],
      assetBasePath: "/hub-assets",
      pathMap: new Map([
        ["/engineering/widgets/", "/guidance/widgets"],
        ["/engineering/widgets/setup.html", "/guidance/widgets-setup"],
        ["/tools/lantern-notes-wiki/", "/tools/lanternly"],
        ["/InfoSec/device-policy.html", "/policies/device-policy"],
      ]),
    },
    ...overrides,
  };
}

function extract(content: string, overrides: Partial<ExtractOptions> = {}) {
  return extractContent(builtPage(content), options(overrides));
}

function codes(warnings: readonly { code: string }[]): string[] {
  return warnings.map((warning) => warning.code);
}

describe("the content area", () => {
  it("keeps only the content area, without the layout around it", () => {
    const result = extract("<h1>Widgets</h1><p>Widget text.</p>");
    expect(result.bodyMarkdown).toBe("Widget text.");
    for (const layoutText of [
      "Example Hub",
      "Tools in the menu",
      "Left-hand link",
      "Edit this page",
      "Example footer text",
    ]) {
      expect(result.bodyMarkdown).not.toContain(layoutText);
    }
  });

  it("uses the configured content selector", () => {
    const html = builtPage("<h1>Widgets</h1><p>Widget text.</p>", "article");
    const result = extractContent(html, options({ contentSelector: "article" }));
    expect(result.title).toBe("Widgets");
    expect(result.bodyMarkdown).toBe("Widget text.");
  });

  it("flags a page with no content area for manual review", () => {
    const result = extractContent("<html><body><p>No main here</p></body></html>", options());
    expect(result.bodyMarkdown).toBe("");
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ code: "content_area_missing", manualReview: true }),
    );
  });

  it("removes in-page contents, review lines and feedback links on the strip-list", () => {
    const result = extract(`
      <h1>Widgets</h1>
      <nav class="toc"><a href="#set-up">On this page: set up</a></nav>
      <p>Widget text.</p>
      <p class="page-review">This page was last reviewed on 1 January 2026.</p>
      <div class="feedback"><a href="https://example.com/feedback">Give feedback</a></div>`);
    expect(result.bodyMarkdown).toBe("Widget text.");
  });

  it("removes extra selectors added to the strip-list", () => {
    const result = extract('<h1>Widgets</h1><div class="example-banner">Banner</div><p>Text.</p>', {
      stripSelectors: [...DEFAULT_STRIP_SELECTORS, ".example-banner"],
    });
    expect(result.bodyMarkdown).toBe("Text.");
  });
});

describe("the title", () => {
  it("comes from the h1, which is left out of the body", () => {
    const result = extract('<h1 id="widgets">Widgets &amp; gadgets</h1><p>Text.</p>');
    expect(result.title).toBe("Widgets & gadgets");
    expect(result.bodyMarkdown).not.toContain("# Widgets");
  });

  it("is flagged for manual review when there is no h1", () => {
    const result = extract("<p>Text.</p>");
    expect(result.title).toBeUndefined();
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ code: "missing_title", manualReview: true }),
    );
  });

  it("comes from the first h1 when there are several, with a warning", () => {
    const result = extract("<h1>First</h1><p>Text.</p><h1>Second</h1>");
    expect(result.title).toBe("First");
    expect(result.bodyMarkdown).toContain("# Second");
    expect(codes(result.warnings)).toContain("multiple_titles");
  });
});

describe("HTML to markdown", () => {
  it("converts headings", () => {
    const result = extract("<h1>Title</h1><h2>Two</h2><h3>Three</h3><h4>Four</h4>");
    expect(result.bodyMarkdown).toBe("## Two\n\n### Three\n\n#### Four");
  });

  it("converts paragraphs, emphasis and line breaks", () => {
    const result = extract(
      "<h1>T</h1><p>One <strong>bold</strong> and <em>soft</em>.<br>Next line.</p>",
    );
    expect(result.bodyMarkdown).toBe("One **bold** and _soft_.  \nNext line.");
  });

  it("converts bulleted, numbered and nested lists", () => {
    const result = extract(`<h1>T</h1>
      <ul><li>apples</li><li>pears</li></ul>
      <ol>
        <li>Install the widget.</li>
        <li>Configure it:
          <ul><li>pick a colour</li><li>pick a size</li></ul>
        </li>
      </ol>`);
    expect(result.bodyMarkdown).toBe(
      "- apples\n- pears\n\n1. Install the widget.\n2. Configure it:\n   - pick a colour\n   - pick a size",
    );
  });

  it("converts a numbered list that doesn't start at one", () => {
    const result = extract('<h1>T</h1><ol start="4"><li>four</li><li>five</li></ol>');
    expect(result.bodyMarkdown).toBe("4. four\n5. five");
  });

  it("converts a simple table to a markdown table", () => {
    const result = extract(`<h1>T</h1>
      <div class="table-container"><table>
        <thead><tr><th>Size</th><th>Use for</th></tr></thead>
        <tbody>
          <tr><td>Small</td><td>Prototypes | demos</td></tr>
          <tr><td>Large</td><td><p>Production</p><p>Shared services</p></td></tr>
        </tbody>
      </table></div>`);
    expect(result.bodyMarkdown).toBe(
      [
        "| Size | Use for |",
        "| --- | --- |",
        "| Small | Prototypes \\| demos |",
        "| Large | Production<br>Shared services |",
      ].join("\n"),
    );
    expect(result.warnings).toEqual([]);
  });

  it("uses the first row as the header of a table with no thead", () => {
    const result = extract(
      "<h1>T</h1><table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>",
    );
    expect(result.bodyMarkdown).toBe("| A | B |\n| --- | --- |\n| 1 | 2 |");
  });

  it("keeps a table markdown can't show as HTML and flags it for manual review", () => {
    const result = extract(`<h1>T</h1>
      <table>
        <tr><th>Limit</th><th>Details</th></tr>
        <tr><td>Rate</td><td><ul><li>10 a second</li><li>500 a minute</li></ul></td></tr>
      </table>`);
    expect(result.bodyMarkdown).toContain("<table>");
    expect(result.bodyMarkdown).toContain("<li>500 a minute</li>");
    expect(result.bodyMarkdown).not.toContain("data-migration");
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ code: "complex_table", manualReview: true }),
    );
  });

  it("flags a table with merged cells for manual review", () => {
    const result = extract(
      '<h1>T</h1><table><tr><th colspan="2">Both</th></tr><tr><td>1</td><td>2</td></tr></table>',
    );
    expect(result.bodyMarkdown).toContain('colspan="2"');
    expect(codes(result.warnings)).toContain("complex_table");
  });

  it("converts inline code and code blocks, keeping the language", () => {
    const result = extract(`<h1>T</h1>
      <p>Run <code>widget start</code> to begin.</p>
      <div class="highlight"><pre class="highlight shell" tabindex="0"><code>widget start --colour blue
widget status
</code></pre></div>
      <pre><code class="language-yaml">key: value
</code></pre>`);
    expect(result.bodyMarkdown).toBe(
      "Run `widget start` to begin.\n\n```shell\nwidget start --colour blue\nwidget status\n```\n\n```yaml\nkey: value\n```",
    );
  });

  it("leaves out the language of a plain-text code block", () => {
    const result = extract(
      '<h1>T</h1><pre class="highlight plaintext"><code>just text</code></pre>',
    );
    expect(result.bodyMarkdown).toBe("```\njust text\n```");
  });

  it("keeps text that looks like a tag or an entity as text", () => {
    const result = extract(
      "<h1>Widgets</h1><p>Use &lt;details&gt; and &amp;nbsp; here, or <code>&lt;div&gt;</code>.</p>",
    );
    expect(result.bodyMarkdown).toBe("Use \\<details> and \\&nbsp; here, or `<div>`.");
  });

  it("converts block quotes", () => {
    const result = extract("<h1>T</h1><blockquote><p>Quoted.</p></blockquote>");
    expect(result.bodyMarkdown).toBe("> Quoted.");
  });

  it("converts and rewrites links", () => {
    const result = extract(`<h1>T</h1>
      <p>Read the <a href="setup.html">set-up guide</a>, the <a href="/tools/lantern-notes-wiki/">notes tool</a>,
      the <a href="https://hub.example.com/InfoSec/device-policy.html#scope">policy</a>,
      the <a href="https://www.example.org/widgets">website</a> and <a href="mailto:widgets@example.com">email us</a>.</p>`);
    expect(result.bodyMarkdown).toBe(
      "Read the [set-up guide](/guidance/widgets-setup), the [notes tool](/tools/lanternly), " +
        "the [policy](/policies/device-policy#scope), the [website](https://www.example.org/widgets) " +
        "and [email us](mailto:widgets@example.com).",
    );
    expect(result.warnings).toEqual([]);
  });

  it("flags a link to an internal page that wasn't found", () => {
    const result = extract('<h1>T</h1><p><a href="/engineering/missing-page.html">Gone</a></p>');
    expect(result.bodyMarkdown).toBe("[Gone](/engineering/missing-page.html)");
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ code: "unknown_internal_link", manualReview: true }),
    );
  });

  it("rewrites image paths and lists the images", () => {
    const result = extract(
      '<h1>T</h1><p><img src="/images/../images/widgets/diagram.svg" alt="Diagram of a widget"></p>',
    );
    expect(result.bodyMarkdown).toBe(
      "![Diagram of a widget](/hub-assets/images/widgets/diagram.svg)",
    );
    expect(result.assets).toEqual(["/images/widgets/diagram.svg"]);
  });

  it("flags an image with no alternative text", () => {
    const result = extract('<h1>T</h1><p><img src="/images/widgets/diagram.svg"></p>');
    expect(codes(result.warnings)).toContain("missing_alt_text");
  });
});

describe("elements markdown can't show", () => {
  it.each([
    ['<iframe src="https://video.example.com/embed/demo" title="Demo"></iframe>', "<iframe"],
    ["<dl><dt>Term</dt><dd>Definition</dd></dl>", "<dl>"],
    ['<form action="/search/"><input name="q"><button>Search</button></form>', "<form"],
    ["<details><summary>More</summary><p>Hidden text</p></details>", "<details>"],
  ])("keeps %s as HTML and flags it for manual review", (html, kept) => {
    const result = extract(`<h1>T</h1>${html}`);
    expect(result.bodyMarkdown).toContain(kept);
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ code: "unsupported_element", manualReview: true }),
    );
  });

  it("removes scripts and styles, with a warning rather than silently", () => {
    const result = extract("<h1>T</h1><p>Text.</p><script>track()</script><style>p{}</style>");
    expect(result.bodyMarkdown).toBe("Text.");
    expect(codes(result.warnings)).toEqual(["removed_element", "removed_element"]);
  });

  it("never includes page content in a warning", () => {
    const result = extract(
      '<p>Private words.</p><iframe title="Private title"></iframe><a href="/missing.html">Private link text</a>',
    );
    expect(JSON.stringify(result.warnings)).not.toContain("Private");
  });
});

describe("a fixture page from the fake shared layout", () => {
  it("is converted with its layout, contents and review line removed", () => {
    const html = readFileSync(
      path.join(FIXTURE_BUILD_DIR, "engineering/widgets/index.html"),
      "utf8",
    );
    const result = extractContent(html, options());
    expect(result.title).toBe("Widgets");
    expect(result.bodyMarkdown.startsWith("Widgets help teams build **example things**.")).toBe(
      true,
    );
    expect(result.bodyMarkdown).toContain("## Set up");
    expect(result.bodyMarkdown).toContain("| Small | Prototypes \\| demos |");
    expect(result.bodyMarkdown).toContain("```shell");
    for (const removed of [
      "On this page",
      "last reviewed",
      "Give feedback",
      "Example footer text",
    ]) {
      expect(result.bodyMarkdown).not.toContain(removed);
    }
    expect(new Set(codes(result.warnings))).toEqual(
      new Set(["unknown_internal_link", "complex_table", "unsupported_element"]),
    );
  });
});

describe("a blog post's date", () => {
  it("is read from its published line, which is left out of the body", () => {
    const result = extract(
      '<article><p class="post-date">Published on: October  8, 2026</p><h1>Post</h1><p>Text.</p></article>',
    );
    expect(result.publishedDate).toBe("2026-10-08");
    expect(result.bodyMarkdown).toBe("Text.");
  });

  it("is missing when the page has no published line", () => {
    expect(extract("<h1>Page</h1><p>Text.</p>").publishedDate).toBeUndefined();
  });

  it("is flagged for manual review when the published line can't be read", () => {
    const result = extract('<p class="post-date">Published on: sometime</p><h1>Post</h1>');
    expect(result.publishedDate).toBeUndefined();
    expect(result.warnings).toContainEqual(
      expect.objectContaining({ code: "invalid_date", manualReview: true }),
    );
  });
});

describe("redirect pages", () => {
  it("gives the target of a meta refresh page", () => {
    const html = readFileSync(path.join(FIXTURE_BUILD_DIR, "old-widgets.html"), "utf8");
    expect(redirectTarget(html)).toBe("engineering/widgets/");
  });

  it("gives nothing for an ordinary page", () => {
    expect(redirectTarget(builtPage("<h1>T</h1>"))).toBeUndefined();
  });
});
