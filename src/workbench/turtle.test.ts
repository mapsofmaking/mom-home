import { describe, expect, it } from "vitest";
import { highlightTurtle, highlightTurtleLine } from "./turtle";

describe("Turtle coloured as the map's card colours it (14.6 S2)", () => {
  it("colours prefixes, names, strings, IRIs and numbers with the design system's classes", () => {
    const html = highlightTurtleLine(`  schema:openingHours "Mo 9-12" ; schema:url <https://x.example/> ; schema:latitude 50.8 .`);
    expect(html).toContain('<span class="c">schema:</span><span class="k">openingHours</span>');
    expect(html).toContain('<span class="s">&quot;Mo 9-12&quot;</span>');
    expect(html).toContain('<span class="n">&lt;https://x.example/&gt;</span>');
    expect(html).toContain('<span class="n">50.8</span>');
  });

  it("@prefix, blank-node labels and `a` get their own colours", () => {
    expect(highlightTurtleLine("@prefix schema: <https://schema.org/> .")).toContain('<span class="c">@prefix</span>');
    expect(highlightTurtleLine("_:b0 a schema:Place")).toMatch(/<span class="c">_:b0<\/span> <span class="k">a<\/span>/);
  });

  it("never lets the file's text become markup", () => {
    const html = highlightTurtleLine(`  schema:name "<img src=x onerror=alert(1)>" .`);
    expect(html).not.toContain("<img");
    const host = document.createElement("pre");
    host.innerHTML = highlightTurtle(`<#s> schema:name "<script>x</script>" .`);
    expect(host.querySelector("script, img")).toBeNull();
  });

  it("one span per line, the changed line marked", () => {
    const host = document.createElement("pre");
    host.innerHTML = highlightTurtle(`<#space> a mom:Space ;\n  schema:openingHours "Mo" .\n`, /openingHours/);
    expect(host.querySelectorAll(".line")).toHaveLength(2);
    expect(host.querySelector(".chg")!.textContent).toBe(`  schema:openingHours "Mo" .`);
  });
});
