import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { tileStates } from "../tree/fog";
import { parseTree } from "../tree/parse";
import { hexPosition, renderHexView, tileLabel } from "./hexview";
import { locality, renderPreview } from "./previews";
import { renderStep } from "./step";
import { metWords, renderWords } from "./words";
import { renderHexRow } from "./hexrow";
import { fallbackName } from "./who";

const tree = parseTree(readFileSync(join(__dirname, "../../public/onboarding.ttl"), "utf8"));
const byId = Object.fromEntries(tree.tiles.map((t) => [t.id, t]));
const at = (...done: string[]) => tileStates(tree.tiles, new Set(done));
const html = (s: string) => {
  const div = document.createElement("div");
  div.innerHTML = s;
  return div;
};

describe("hex view (AC7)", () => {
  it("places neighbours a row apart, half a hex across", () => {
    const a = hexPosition(0, 0);
    const b = hexPosition(0, 1);
    expect(b.y - a.y).toBeCloseTo(94.5);
    expect(b.x - a.x).toBeCloseTo(hexPosition(1, 0).x / 2);
  });

  it("labels by state: title when open or done, cue while coming, nothing in the fog", () => {
    expect(tileLabel(byId.describe, "open")).toBe("Describe your space");
    expect(tileLabel(byId.keep, "cue")).toBe("Out there for real");
    expect(tileLabel(byId.peers, "fog")).toBe("");
  });

  it("makes every tile but fog a button, and marks the selected one", () => {
    const view = html(renderHexView(tree.tiles, at(), "describe"));
    const buttons = [...view.querySelectorAll("button[data-tile]")].map((b) => b.getAttribute("data-tile"));
    expect(buttons).toEqual(["describe", "keep"]);
    expect(view.querySelector('[aria-current="step"]')?.getAttribute("data-tile")).toBe("describe");
    expect(view.querySelectorAll(".hx.fog[aria-hidden]")).toHaveLength(11);
    expect(view.textContent).toContain("11 more still to discover");
  });

  it("gives done and open tiles their picto, no tick; ready is drawn as a cue", () => {
    const view = html(renderHexView(tree.tiles, at("describe", "keep"), null));
    expect(view.querySelector('[data-tile="keep"]')!.className).toContain("done");
    expect(view.querySelector('[data-tile="keep"] .hx-ico')).not.toBeNull();
    expect(view.querySelector('[data-tile="change"] .hx-ico')).not.toBeNull();
    expect(view.querySelector('[data-tile="answer"] .hx-ico')).toBeNull(); // coming
    expect(view.querySelector(".hx-tick")).toBeNull();
    expect(view.textContent).not.toContain("✓");
    expect(view.querySelector('[data-tile="second"]')!.className).toContain("cue");
    expect(view.querySelector('[data-tile="second"]')!.getAttribute("aria-label")).toBe(
      "Coming: More maps, no extra work, ready"
    );
  });
});

describe("step panel", () => {
  const step = (id: string, ...done: string[]) =>
    html(renderStep(byId[id], { tiles: tree.tiles, states: at(...done), draft: {} }));

  it("labels every preview, with the chip COMING (AC6)", () => {
    const all = tree.tiles.map((t) => t.id);
    // Tile A shows its form while open; its preview comes once done (below).
    for (const t of tree.tiles.filter((t) => t.preview && t.act !== "describe")) {
      const done = all.filter((id) => id !== t.id && !["discord", "mentor", "bridge"].includes(id));
      const s = step(t.id, ...done);
      if (t.emergent || t.planned) continue;
      expect(s.textContent, t.id).toContain("Preview · nothing is published");
      expect(s.querySelector(".status-label")!.textContent).toBe("Coming");
    }
  });

  it("flags tile A's form with no chip while open, and Done once done", () => {
    expect(step("describe").querySelector(".status-label")).toBeNull();
    expect(step("describe", "describe").querySelector(".status-label")!.textContent).toBe("Done");
  });

  it("speaks the tree's lines, never its own", () => {
    expect(step("describe").querySelector(".bernard-voice")!.textContent).toBe(`— ${byId.describe.lines.say}`);
    expect(step("keep", "describe").querySelector(".bernard-voice")!.textContent).toBe(`— ${byId.keep.lines.say}`);
    expect(step("keep", "describe", "keep").querySelector(".bernard-voice")!.textContent).toBe(
      `— ${byId.keep.lines.saidDone}`
    );
  });

  it("shows a coming tile's outcome and what it waits for, not how it works", () => {
    const s = step("keep");
    expect(s.querySelector("h2")!.textContent).toBe("Out there for real");
    expect(s.querySelector(".wb-needs")!.textContent).toContain("Describe your space");
    expect(s.textContent).not.toContain(byId.keep.lines.say);
  });

  it("names a requirement still in the fog without naming it", () => {
    const t = (id: string, all: string[] = []) => ({ ...byId.describe, id, title: `${id} title`, requiresAll: all });
    const tiles = [t("a"), t("b", ["a"]), t("c", ["b"]), t("x", ["a", "c"])];
    const states = tileStates(tiles, new Set(["a"]));
    expect(states.get("c")).toBe("cue"); // next to b, which is open
    expect(states.get("x")).toBe("cue"); // next to a, which is done
    const s = html(renderStep(tiles[3], { tiles, states, draft: {} })).textContent!;
    expect(s).toContain("a title");
    expect(s).toContain("c title"); // a cue is seen on the map, so it is named
    const fogged = tileStates([t("a"), t("b", ["a"]), t("c", ["b"]), t("x", ["a", "c"])], new Set(["a"]));
    fogged.set("c", "fog");
    const hidden = html(renderStep(tiles[3], { tiles, states: fogged, draft: {} })).textContent!;
    expect(hidden).toContain("Something still to discover");
    expect(hidden).not.toContain("c title");
  });

  it("says ready when only the limit holds a tile", () => {
    expect(step("second", "describe", "keep").textContent).toContain("three at a time");
  });

  it("lets a planned tile say why it won't open", () => {
    const s = step("discord", "describe", "keep", "change", "answer");
    expect(s.querySelector(".bernard-voice")!.textContent).toContain("Not built yet");
  });
});

describe("tile A, a feel of the form until 14.2", () => {
  const ctx = (done: string[], editing = false) => ({ tiles: tree.tiles, states: at(...done), draft: { name: "Atelier" }, editing });

  it("asks for five things, keeps what was typed, and says nothing is sent", () => {
    const s = html(renderStep(byId.describe, ctx([])));
    expect([...s.querySelectorAll("input")].map((i) => i.name)).toEqual(["name", "address", "description", "email", "hours"]);
    expect((s.querySelector("#f-name") as HTMLInputElement).value).toBe("Atelier");
    expect(s.textContent).toContain("Nothing is sent anywhere");
  });

  it("once done, shows the card it made, labelled, and one way on", () => {
    const s = html(renderStep(byId.describe, ctx(["describe"])));
    expect(s.querySelector("form")).toBeNull();
    expect(s.textContent).toContain("Preview · nothing is published");
    expect(s.textContent).toContain("Atelier");
    expect(s.querySelector('[data-go="keep"]')!.textContent).toBe("Publish it");
  });

  it("reopens the form to fix something", () => {
    expect(html(renderStep(byId.describe, ctx(["describe"], true))).querySelector("form")).not.toBeNull();
  });

  it("reads the form back, and fills the example", async () => {
    const { fillExample, readDescribeForm, EXAMPLE } = await import("./describe");
    const form = html(renderStep(byId.describe, ctx([]))).querySelector("form")!;
    fillExample(form);
    const draft = {};
    readDescribeForm(form, draft);
    expect(draft).toEqual(EXAMPLE);
  });
});

describe("previews show only what was typed", () => {
  it("says 'Your space' until a name is typed, and escapes it after", () => {
    expect(renderPreview("mapcard", {})).toContain("Your space");
    expect(renderPreview("mapcard", { name: "<b>Atelier</b>" })).toContain("&lt;b&gt;Atelier&lt;/b&gt;");
  });
  it("reads the locality off an address", () => {
    expect(locality("Rue du Canal 12, 1070 Anderlecht")).toBe("Anderlecht");
    expect(locality("")).toBe("");
  });
});

describe("words you've met (AC5)", () => {
  const strip = (...done: string[]) => html(renderWords(tree, new Set(done)));

  it("stays hidden until a first word unlocks", () => {
    expect(renderWords(tree, new Set())).toBe("");
    expect(renderWords(tree, new Set(["describe"]))).toBe(""); // describe unlocks no word
  });

  it("unlocks a word right after the tile that shows what it names", () => {
    expect([...metWords(tree, new Set(["describe", "keep"]))]).toEqual(["pod"]);
    expect([...metWords(tree, new Set(["describe", "keep", "change"]))].sort()).toEqual(["endpoint", "pod"]);
  });

  it("gives every word a place: met as a WordChip, the rest as dots", () => {
    const s = strip("describe", "keep");
    const chips = [...s.querySelectorAll("li")];
    expect(chips).toHaveLength(tree.words.length);
    expect(chips[0].querySelector("button.wd")!.textContent).toContain("pod");
    expect(s.querySelectorAll(".wd.locked")).toHaveLength(tree.words.length - 1);
    expect(s.querySelector(".wd.locked")!.getAttribute("aria-label")).toBe("A word not met yet");
    expect(s.textContent).not.toContain("endpoint");
  });

  it("shows the meaning in a tip tied to the chip, never in a title", () => {
    const s = strip("describe", "keep");
    const chip = s.querySelector<HTMLButtonElement>("button.wd")!;
    const tip = s.querySelector(`#${chip.getAttribute("aria-describedby")}`)!;
    expect(tip.getAttribute("role")).toBe("tooltip");
    expect(tip.textContent).toBe(tree.words.find((w) => w.id === "pod")!.meaning);
    expect(s.querySelector("[title]")).toBeNull();
    expect(chip.getAttribute("aria-pressed")).toBe("false");
    expect(html(renderWords(tree, new Set(["describe", "keep"]), "pod")).querySelector("button.wd")!.getAttribute("aria-pressed")).toBe("true");
  });
});

describe("folded row (AC7)", () => {
  const row = (...done: string[]) => html(renderHexRow(tree.tiles, at(...done), "change"));

  it("shows the tiles reached, in order, and counts the rest to discover", () => {
    const r = row("describe", "keep");
    const ids = [...r.querySelectorAll("button[data-tile]")].map((b) => b.getAttribute("data-tile"));
    expect(ids).toEqual(["describe", "keep", "change", "join", "event", "answer", "second", "peers", "agenda", "handover"]);
    expect(r.textContent).toContain("+ 3 to discover");
    expect(r.querySelector(".hx-now")!.textContent).toContain("Update it once");
    const toggle = r.querySelector("#unfold")!;
    expect(toggle.textContent).toBe("Show all");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("gives done and open tiles their picto in the toolbar, coming ones none", () => {
    const r = row("describe", "keep");
    expect(r.querySelector('[data-tile="keep"] .ico')).not.toBeNull();
    expect(r.querySelector('[data-tile="change"] .ico')).not.toBeNull();
    expect(r.querySelector('[data-tile="answer"] .ico')).toBeNull();
    expect(r.querySelector('[data-tile="answer"]')!.getAttribute("aria-label")).toBe("Coming: Stop answering the same question");
    expect(r.querySelector('[data-tile="change"]')!.getAttribute("aria-current")).toBe("step");
  });

  it("names a tile on hover or focus", () => {
    expect(row("describe").querySelector('[data-tile="describe"] .tip')!.textContent).toBe("Describe your space");
  });
});

describe("signed in as", () => {
  it("falls back to the pod's own label when the profile has no name", () => {
    expect(fallbackName("https://atelier.pod.mapsofmaking.org/profile/card#me")).toBe("atelier");
    expect(fallbackName("https://pod.example.org/nicolas/profile/card#me")).toBe("nicolas");
  });
});
