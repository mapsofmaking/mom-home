import { describe, it, expect } from "vitest";
import { renderMarkdown } from "./markdown";

describe("Markdown from a pod", () => {
  it("renders headings, lists, emphasis and code", () => {
    const html = renderMarkdown("# Title\n\n- one\n- **two**\n\n`code`");
    expect(html).toContain("<h1>Title</h1>");
    expect(html).toContain("<strong>two</strong>");
    expect(html).toContain("<code>code</code>");
  });

  it("drops scripts, event handlers, javascript: links and styles", () => {
    const html = renderMarkdown(
      [
        "<script>alert(1)</script>",
        '<img src="x" onerror="alert(2)">',
        "[click](javascript:alert(3))",
        '<a href="data:text/html,x">data</a>',
        '<p style="position:fixed">over</p>',
        "<iframe src=\"https://evil.example\"></iframe>",
      ].join("\n\n")
    );
    expect(html).not.toMatch(/<script|onerror|javascript:|data:text|style=|<iframe/i);
  });

  it("opens links in a new tab without handing it this page", () => {
    const html = renderMarkdown("[pod](https://pod.example/)");
    expect(html).toContain('href="https://pod.example/"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('target="_blank"');
  });

  it("shows a YAML header as fields, with its lists and links, and the body after it", () => {
    const html = renderMarkdown(
      [
        "---",
        "titre: Du « faire plutôt que dire »",
        "auteur: https://pod.example/ndb/profile/card#me",
        "sujets: [gouvernance, \"stigmergie\"]",
        "s-appuie-sur:",
        "  - https://pod.example/hs/depots/a/",
        "  - https://pod.example/hs/depots/b/",
        "---",
        "# Body",
      ].join("\n")
    );
    const dl = new DOMParser().parseFromString(html, "text/html").querySelector("dl.front-matter")!;
    const fields = [...dl.querySelectorAll(":scope > div")].map((d) => [d.querySelector("dt")!.textContent, [...d.querySelectorAll("dd")].map((x) => x.textContent)]);
    expect(fields).toEqual([
      ["titre", ["Du « faire plutôt que dire »"]],
      ["auteur", ["https://pod.example/ndb/profile/card#me"]],
      ["sujets", ["gouvernance", "stigmergie"]],
      ["s-appuie-sur", ["https://pod.example/hs/depots/a/", "https://pod.example/hs/depots/b/"]],
    ]);
    expect(dl.querySelector('dd a[href="https://pod.example/hs/depots/a/"]')).not.toBeNull();
    expect(html).toContain("<h1>Body</h1>");
    expect(html).not.toContain("<hr>");
  });

  it("sanitizes the header like the body, and leaves a header it cannot read as written", () => {
    const html = renderMarkdown("---\nnote: <img src=x onerror=alert(1)> [x](javascript:alert(2))\n---\ntext");
    expect(html).not.toMatch(/onerror|javascript:/i);
    expect(html).toContain("front-matter");
    const odd = renderMarkdown("---\n{ not: yaml }\n---\ntext");
    expect(odd).not.toContain("front-matter");
  });

  it("keeps a fenced block's lines together, as one block", () => {
    const html = renderMarkdown("```\nmembre --> inbox/\n     |\n     v\n```");
    expect(html).toMatch(/<pre><code>membre --&gt; inbox\/\n {5}\|\n {5}v\n<\/code><\/pre>/);
  });
});
