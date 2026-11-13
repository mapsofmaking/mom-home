// @vitest-environment node
// The pages test.mapsofmaking.org serves, built as the image builds them, then walked in jsdom.
// What broke before, or would break silently:
//   - the dry run reads the app's tree: a tile or a ui* key renamed in public/onboarding.ttl must
//     fail here, not on the staging site;
//   - the hosted page may call no other host (the gateway's policy blocks it, and the page breaks);
//   - on the network's side, a join request waits for a hand-given yes; on the space's side the
//     dry run's timer answers.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JSDOM, VirtualConsole } from "jsdom";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "../build.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
let out;
beforeAll(() => { out = build(mkdtempSync(join(tmpdir(), "mom-staging-"))); });
afterAll(() => rmSync(out, { recursive: true, force: true }));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function open(page, hash = "") {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", (e) => errors.push(String(e.detail || e.message || e)));
  const file = join(out, page);
  const dom = await JSDOM.fromFile(file, {
    runScripts: "dangerously", resources: "usable", pretendToBeVisual: true, virtualConsole: vc,
    url: "file://" + file + hash,
    beforeParse(w) { w.matchMedia = () => ({ matches: false, addEventListener() {} }); },
  });
  await new Promise((r) => (dom.window.document.readyState === "complete" ? r() : dom.window.addEventListener("load", r)));
  await sleep(50);
  const w = dom.window, d = w.document;
  const $ = (id) => d.getElementById(id);
  const q = (s) => d.querySelector(s);
  const click = (el) => { expect(el, "an element to click").toBeTruthy(); el.dispatchEvent(new w.MouseEvent("click", { bubbles: true, cancelable: true })); };
  const submit = (id) => $(id).dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true }));
  const text = (id) => $(id).textContent;
  return { w, d, $, q, click, submit, text, errors, close: () => w.close() };
}

describe("the build", () => {
  it("serves the app's own tree, not the artifact's copy", () => {
    const page = readFileSync(join(out, "dry-run/index.html"), "utf8");
    const tree = readFileSync(join(root, "public/onboarding.ttl"), "utf8");
    const a = page.indexOf('<script type="text/turtle" id="tree">\n') + '<script type="text/turtle" id="tree">\n'.length;
    expect(page.slice(a, page.indexOf("</script>", a)).trim()).toBe(tree.trim());
  });
  it("calls no other host", () => {
    for (const p of ["index.html", "tour/index.html", "dry-run/index.html"]) {
      const html = readFileSync(join(out, p), "utf8");
      expect(html, p).not.toMatch(/<(script|link)[^>]+(src|href)="https?:/);
      expect(html, p).not.toMatch(/fonts\.googleapis|cdn\.jsdelivr/);
    }
  });
});

describe("the tour", () => {
  it("goes forward and back, and ends on the dry run", async () => {
    const t = await open("tour/index.html");
    expect(t.text("count")).toBe("1 of 7");
    expect(t.$("prev").disabled).toBe(true);
    for (let k = 0; k < 3; k++) t.click(t.$("next"));
    expect(t.text("count")).toBe("4 of 7");
    expect(t.text("l-hs")).toBe("handshake");
    t.d.dispatchEvent(new t.w.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(t.text("count")).toBe("5 of 7");
    t.click(t.$("next")); t.click(t.$("next")); t.click(t.$("next"));
    expect(t.text("count")).toBe("7 of 7");
    expect(t.$("end").hidden).toBe(false);
    expect(t.q(".cta").getAttribute("href")).toBe("../dry-run/");
    t.click(t.q('[data-k="1"]'));
    expect(t.text("count")).toBe("2 of 7");
    expect(t.errors).toEqual([]);
    t.close();
  });
  it("opens a scene by its address", async () => {
    const t = await open("tour/index.html", "#6");
    expect(t.text("count")).toBe("6 of 7");
    t.close();
  });
});

describe("the dry run", () => {
  it("draws the tree's tiles, with the role tabs in the header", async () => {
    const p = await open("dry-run/index.html");
    expect(p.q('#map [data-id="describe"]')).toBeTruthy();
    expect(p.d.querySelectorAll("header #roles button")).toHaveLength(3);
    expect(p.errors).toEqual([]);
    p.close();
  });

  it("signs in with the demo pod and asks only what is missing", async () => {
    const p = await open("dry-run/index.html", "#signin");
    p.click(p.$("demopod")); p.submit("f-signin"); await sleep(20);
    p.click(p.$("podallow")); await sleep(20);
    expect(p.text("bench")).toMatch(/already there/);
    expect(p.text("bench")).toMatch(/Needed now/);
    expect(p.errors).toEqual([]);
    p.close();
  });

  it("on the network's side, the request waits for a yes given by hand", async () => {
    const p = await open("dry-run/index.html", "#published");
    p.click(p.q('#map [data-id="join"]'));
    p.$("f-network").value = "Brussels Makers"; p.submit("f-net");
    p.click(p.q('#roles [data-role="welcome"]'));
    await sleep(6500);
    expect(p.text("bench")).toMatch(/Request/);
    p.click(p.q("[data-accept]"));
    expect(p.text("bench")).toMatch(/Listed as a member/);
    p.click(p.q('#roles [data-role="treasury"]'));
    p.click(p.q("#bench [data-remind]"));
    expect(p.text("bench")).toMatch(/Due · reminder 1 of 3/);
    p.click(p.q('#roles [data-role="space"]'));
    p.click(p.q('#map [data-id="join"]'));
    expect(p.text("bench")).toMatch(/Reminder 1 of 3/);
    expect(p.errors).toEqual([]);
    p.close();
  }, 20000);

  it("on the space's side, the dry run's timer answers", async () => {
    const p = await open("dry-run/index.html", "#published");
    p.click(p.q('#map [data-id="join"]'));
    p.$("f-network").value = "Brussels Makers"; p.submit("f-net");
    await sleep(6500);
    expect(p.text("bench")).toMatch(/said yes/);
    p.close();
  }, 20000);
});
