import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { tileStates } from "../tree/fog";
import { parseTree } from "../tree/parse";
import { hexPosition, renderHexView, tileLabel } from "./hexview";
import { renderPreview } from "./previews";
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

  it("never shows a Done chip: the hexes say it (Nicolas, 14.2)", () => {
    expect(step("describe").querySelector(".status-label")).toBeNull();
    expect(step("describe", "describe").querySelector(".status-label")).toBeNull();
    expect(step("keep", "describe", "keep").querySelector(".status-label")).toBeNull();
  });

  it("speaks the tree's lines, never its own", () => {
    expect(step("describe", "describe").querySelector(".bernard-voice")!.textContent).toBe(`— ${byId.describe.lines.saidDone}`);
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
    const t = (id: string, all: string[] = []) => ({ ...byId.describe, id, title: `${id} title`, cue: `${id} cue`, requiresAll: all });
    const tiles = [t("a"), t("b", ["a"]), t("c", ["b"]), t("x", ["a", "c"])];
    const states = tileStates(tiles, new Set(["a"]));
    expect(states.get("c")).toBe("cue"); // next to b, which is open
    expect(states.get("x")).toBe("cue"); // next to a, which is done
    const s = html(renderStep(tiles[3], { tiles, states, draft: {} })).textContent!;
    expect(s).toContain("a title");
    expect(s).toContain("c cue"); // a cue is seen on the map by its cue, so that is how it is named
    expect(s).not.toContain("c title"); // its title is mechanism: AC3
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

describe("tile A (14.2)", () => {
  const ctx = (done: string[], editing = false) => ({ tiles: tree.tiles, states: at(...done), draft: { name: "Atelier" }, editing });

  it("asks name, then where, then the optional rest; keeps what was typed", () => {
    const s = html(renderStep(byId.describe, ctx([])));
    const typed = [...s.querySelectorAll<HTMLInputElement>("input:not([type=hidden])")].filter((i) => !i.closest("[data-manual]"));
    expect(typed.map((i) => i.name)).toEqual([
      "name", "street", "city", "description", "email", "matrix", "website", "logo",
    ]);
    expect([...s.querySelectorAll("input[required]")].map((i) => i.getAttribute("name"))).toEqual(["name", "city"]);
    expect(s.querySelectorAll(".wb-optional input")).toHaveLength(5);
    expect((s.querySelector("#f-name") as HTMLInputElement).value).toBe("Atelier");
  });

  it("opens with the app's own lead, not Bernard (AC2)", () => {
    const s = html(renderStep(byId.describe, ctx([])));
    expect(s.querySelector(".bernard-voice")).toBeNull();
    expect(s.querySelector(".wb-lead")!.textContent).toContain(byId.describe.lead!);
    expect(s.querySelector(".wb-lead a")!.getAttribute("href")).toBe("https://mapsofmaking.org");
  });

  it("once done, shows the card it made, labelled, and one way on", () => {
    const s = html(renderStep(byId.describe, ctx(["describe"])));
    expect(s.querySelector("form")).toBeNull();
    expect(s.textContent).toContain("Preview · nothing is published");
    // Bernard enters here, and names themselves once (AC6).
    expect(s.querySelector(".bernard-voice")!.textContent).toMatch(/^— Hi, I'm Bernard \(they\/them\)/);
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

describe("tile A's keyboard flow (14.2 AC4)", async () => {
  const { describeCommit, describeKeydown, fillExample, missing, renderDescribeForm } = await import("./describe");
  const mount = (draft = {}) => {
    document.body.innerHTML = renderDescribeForm(draft);
    const form = document.querySelector<HTMLFormElement>("#f-describe")!;
    form.addEventListener("keydown", (e) => describeKeydown(form, e));
    return form;
  };
  const field = (name: string) => document.querySelector<HTMLInputElement>(`[name="${name}"]`)!;
  const beat = (name: string) => document.querySelector<HTMLElement>(`[data-beat="${name}"]`)!;
  const key = (name: string, k: string, shiftKey = false) => {
    const e = new KeyboardEvent("keydown", { key: k, shiftKey, bubbles: true, cancelable: true });
    field(name).dispatchEvent(e);
    return e;
  };

  it("opens with the name only; what isn't reached is inert", () => {
    mount();
    expect(beat("where").hasAttribute("inert")).toBe(true);
    expect(beat("rest").hasAttribute("inert")).toBe(true);
    expect(document.querySelector<HTMLButtonElement>(".wb-cta")!.disabled).toBe(true);
    expect(document.querySelector("#f-name-hint")!.textContent).toBe("Tab or Enter to move on.");
  });

  it("an empty name doesn't move on with Enter, and Tab leaves it as usual", () => {
    mount();
    expect(key("name", "Enter").defaultPrevented).toBe(true);
    expect(key("name", "Tab").defaultPrevented).toBe(false);
    expect(beat("where").hasAttribute("inert")).toBe(true);
  });

  it("name, Tab: where opens and focus goes to the street; Enter in the street goes to the city", () => {
    mount();
    field("name").value = "Atelier";
    expect(key("name", "Tab").defaultPrevented).toBe(true);
    expect(beat("where").hasAttribute("inert")).toBe(false);
    expect(document.activeElement).toBe(field("street"));
    key("street", "Enter");
    expect(document.activeElement).toBe(field("city"));
  });

  it("the city opens the rest; Enter walks the optional fields", () => {
    mount({ name: "Atelier" });
    field("city").value = "Anderlecht";
    key("city", "Enter");
    expect(beat("rest").hasAttribute("inert")).toBe(false);
    expect(document.activeElement).toBe(field("description"));
    key("description", "Enter");
    expect(document.activeElement).toBe(field("email"));
    // The last one submits: Enter is left alone.
    expect(key("logo", "Enter").defaultPrevented).toBe(false);
  });

  it("Shift+Tab is never touched", () => {
    mount();
    field("name").value = "Atelier";
    expect(key("name", "Tab", true).defaultPrevented).toBe(false);
  });

  it("leaving a field commits it without moving focus", () => {
    const form = mount();
    field("name").value = "Atelier";
    describeCommit(form, field("name"));
    expect(beat("where").hasAttribute("inert")).toBe(false);
  });

  it("a draft with the values opens its beats; the example opens them all", () => {
    mount({ name: "Atelier", city: "Anderlecht" });
    expect(beat("rest").hasAttribute("inert")).toBe(false);
    const form = mount();
    expect(missing(form)).toBe(field("name"));
    fillExample(form);
    expect(beat("rest").hasAttribute("inert")).toBe(false);
    // Name and city in, no pin yet: the card waits for the geocoder (S3).
    expect(missing(form)).toBe(field("city"));
    expect(document.querySelector<HTMLButtonElement>(".wb-cta")!.disabled).toBe(true);
  });
});

describe("where: the pin from the geocoder (14.2 AC5)", async () => {
  const { renderDescribeForm, syncCta, readDescribeForm } = await import("./describe");
  const { locate, shortPlace, timing, SAY, unpin, pinByHand } = await import("./where");
  timing.minWait = 0;
  timing.retryGap = 0;
  timing.tick = 0;
  const ANDERLECHT = {
    lat: 50.8390983, lon: 4.3296526, country_code: "BE", postcode: "1070",
    display_name: "Anderlecht, Brussel-Hoofdstad - Bruxelles-Capitale, Région de Bruxelles-Capitale - Brussels Hoofdstedelijk Gewest, 1070, België / Belgique / Belgien",
  };
  const NONE = { lat: null, lon: null, country_code: null, postcode: null, display_name: null };
  const answers = (...bodies: (object | number)[]) => {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => {
      const b = bodies.shift()!;
      return typeof b === "number" ? new Response("", { status: b }) : Response.json(b);
    });
    vi.stubGlobal("fetch", fetch);
    return fetch;
  };
  afterEach(() => vi.unstubAllGlobals());
  const mount = (draft = {}) => {
    document.body.innerHTML = renderDescribeForm({ name: "Atelier", ...draft });
    return document.querySelector<HTMLFormElement>("#f-describe")!;
  };
  const val = (name: string) => (document.querySelector(`[name="${name}"]`) as HTMLInputElement).value;
  const pin = () => document.querySelector("#f-pin")!;
  const shown = (which: string) => !document.querySelector<HTMLElement>(`[data-manual="${which}"]`)!.hidden;
  const cta = () => document.querySelector<HTMLButtonElement>(".wb-cta")!;

  it("shortens Nominatim's place to three readable parts", () => {
    expect(shortPlace(ANDERLECHT.display_name)).toBe("Anderlecht, Brussel-Hoofdstad, Région de Bruxelles-Capitale");
    expect(shortPlace("Springfield Garage, Canal Street, Long Eaton, City of Nottingham")).toBe("Springfield Garage, Canal Street, Long Eaton");
  });

  it("a city alone is enough: the pin, the postcode and the country come from the answer, and the card opens", async () => {
    const fetch = answers(ANDERLECHT);
    const form = mount({ city: "Anderlecht" });
    await locate(form, () => syncCta(form));
    expect(JSON.parse(fetch.mock.calls[0][1]!.body as string)).toEqual({ address: "", city: "Anderlecht", postcode: "", country_code: "" });
    expect(fetch.mock.calls[0][0]).toBe("/api/geocode");
    expect([val("lat"), val("lon"), val("postcode"), val("country")]).toEqual(["50.8390983", "4.3296526", "1070", "BE"]);
    expect(pin().textContent).toBe(`${SAY.found} 50.8391, 4.3297 · Anderlecht, Brussel-Hoofdstad, Région de Bruxelles-Capitale · 1070 · BE`);
    expect(cta().disabled).toBe(false);
    const draft = {};
    readDescribeForm(form, draft);
    expect(draft).toMatchObject({ city: "Anderlecht", country: "BE", lat: "50.8390983", place: "Anderlecht, Brussel-Hoofdstad, Région de Bruxelles-Capitale" });
  });

  it("a street it can't find falls back to the city, and says so", async () => {
    const fetch = answers(NONE, ANDERLECHT);
    const form = mount({ street: "Rue du Canal 12", city: "Anderlecht" });
    await locate(form);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetch.mock.calls[1][1]!.body as string).address).toBe("");
    expect(pin().querySelector(".wb-pin-note")!.textContent).toBe(SAY.streetMissed("Anderlecht"));
    expect(pin().textContent).toContain(`${SAY.found} 50.8391, 4.3297`);
  });

  it("asks once per address", async () => {
    const fetch = answers(ANDERLECHT);
    const form = mount({ city: "Anderlecht" });
    await locate(form);
    await locate(form);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("no country in the answer: a two-letter field, and the card waits for it", async () => {
    answers({ ...ANDERLECHT, country_code: null });
    const form = mount({ city: "Anderlecht" });
    await locate(form, () => syncCta(form));
    expect(shown("country")).toBe(true);
    expect(cta().disabled).toBe(true);
    (form.elements.namedItem("country") as HTMLInputElement).value = "BE";
    syncCta(form);
    expect(cta().disabled).toBe(false);
  });

  it("nothing found: names the geocoder, opens the coordinates and the country, keeps what was typed", async () => {
    answers(NONE);
    const form = mount({ city: "Nowhere" });
    await locate(form, () => syncCta(form));
    expect(pin().textContent).toBe(SAY.noResult);
    expect(pin().className).toContain("error");
    expect(shown("coords") && shown("country")).toBe(true);
    expect(val("city")).toBe("Nowhere");
    (form.elements.namedItem("lat") as HTMLInputElement).value = "50.84";
    (form.elements.namedItem("lon") as HTMLInputElement).value = "4.33";
    (form.elements.namedItem("country") as HTMLInputElement).value = "BE";
    pinByHand(form);
    syncCta(form);
    expect(pin().textContent).toBe(`${SAY.byHand} 50.84, 4.33 · BE`);
    expect(cta().disabled).toBe(false);
  });

  it("the geocoder down or busy: says which, never blames the coordinator", async () => {
    answers(503);
    let form = mount({ city: "Anderlecht" });
    await locate(form);
    expect(pin().textContent).toBe(SAY.unavailable);
    expect(shown("coords")).toBe(true);
    answers(429);
    form = mount({ city: "Anderlecht" });
    await locate(form);
    expect(pin().textContent).toBe(SAY.rate);
    expect(shown("coords")).toBe(false);
  });

  it("typing in the address drops the old pin", async () => {
    answers(ANDERLECHT);
    const form = mount({ city: "Anderlecht" });
    await locate(form, () => syncCta(form));
    unpin(form);
    syncCta(form);
    expect([val("lat"), val("country"), pin().textContent]).toEqual(["", "", ""]);
    expect(cta().disabled).toBe(true);
  });

  it("a draft with a pin opens with its line and the card on", () => {
    mount({ city: "Anderlecht", lat: "50.84", lon: "4.33", country: "BE", place: "Anderlecht" });
    expect(pin().textContent).toBe(`${SAY.found} 50.84, 4.33 · Anderlecht · BE`);
    expect(cta().disabled).toBe(false);
  });
});

describe("previews show only what was typed", () => {
  it("says 'Your space' until a name is typed, and escapes it after", () => {
    expect(renderPreview("mapcard", {})).toContain("Your space");
    expect(renderPreview("mapcard", { name: "<b>Atelier</b>" })).toContain("&lt;b&gt;Atelier&lt;/b&gt;");
  });
  it("puts the city on the card, and a town placeholder until there is one", () => {
    expect(renderPreview("mapcard", { city: "Anderlecht" })).toContain("Anderlecht");
    expect(renderPreview("mapcard", {})).toContain("Where you are");
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
