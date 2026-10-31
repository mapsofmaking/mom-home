import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MAX_OPEN, tally, tileStates, type TileState } from "./fog";
import { loadTree } from "./load";
import { parseTree, TreeError, type Tile } from "./parse";

const TTL = readFileSync(join(__dirname, "../../public/onboarding.ttl"), "utf8");
const tree = parseTree(TTL);

const HEAD = `@prefix onb: <https://mapsofmaking.org/ns/onboarding#> .
@prefix : <https://example.org/tree#> .
`;
const tile = (id: string, extra = "", q = 0, r = 0) =>
  `:${id} a onb:Tile ; onb:title "${id} title"@en ; onb:cue "${id} cue"@en ; onb:q ${q} ; onb:r ${r} ; onb:prio 1 ${extra} .\n`;

describe("parseTree, on the shipped tree", () => {
  it("reads every tile and word, in prio order", () => {
    expect(tree.tiles.map((t) => t.id)).toEqual([
      "describe", "keep", "change", "join", "event", "answer", "second",
      "peers", "agenda", "discord", "handover", "mentor", "bridge",
    ]);
    expect(tree.words.map((w) => w.label)).toEqual([
      "pod", "endpoint", "handshake", "agent", "linked data", "WebID", "account",
    ]);
  });

  it("keeps requirements, flags and the word a tile unlocks", () => {
    const by = Object.fromEntries(tree.tiles.map((t) => [t.id, t]));
    expect(by.agenda.requiresAll).toEqual(["join", "event"]);
    expect(by.keep.unlocksWord).toBe("pod");
    expect(by.join.needsPod).toBe(true);
    expect(by.mentor.emergent).toBe(true);
    expect(by.discord.planned).toBe(true);
    expect(by.describe).toMatchObject({ q: 0, r: 0, icon: "pin", act: "describe", preview: "mapcard" });
  });

  it("keeps every line Bernard speaks, by its local name", () => {
    const keep = tree.tiles.find((t) => t.id === "keep")!;
    expect(Object.keys(keep.lines).sort()).toEqual(
      ["say", "sayConsent", "sayNext", "sayPod", "sayTaken", "saidDone", "saidDoneSelf"].sort()
    );
    expect(keep.lines.sayTaken).toMatch(/^The pod server said/);
    expect(tree.app.lines.sayNeedsPod).toMatch(/needs a pod/);
  });
});

describe("the layout (docs/explanation/home-hex-view.md)", () => {
  const hexDistance = (a: Tile, b: Tile) => {
    const dq = a.q - b.q;
    const dr = a.r - b.r;
    return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr));
  };
  /** Tiles that sit away from what they need on purpose: the band mattered more. Adding one here is a decision. */
  const APART = ["second", "handover"];

  it("puts every tile next to something it needs, except the named ones", () => {
    const by = Object.fromEntries(tree.tiles.map((t) => [t.id, t]));
    const lost = tree.tiles
      .filter((t) => [...t.requiresAll, ...t.requiresAny].length > 0)
      .filter((t) => ![...t.requiresAll, ...t.requiresAny].some((id) => hexDistance(t, by[id]) === 1))
      .map((t) => t.id);
    expect(lost.sort()).toEqual([...APART].sort());
  });
});

describe("parseTree refuses a tree that would draw a lie", () => {
  const refuses = (ttl: string, message: RegExp) =>
    expect(() => parseTree(HEAD + ttl)).toThrowError(message);

  it("refuses Turtle that doesn't parse", () => {
    expect(() => parseTree("this is not turtle")).toThrowError(TreeError);
  });
  it("refuses a tree with no tiles", () => refuses("", /no onb:Tile/));
  it("refuses a tile with no cue", () =>
    refuses(`:a a onb:Tile ; onb:title "A" ; onb:q 0 ; onb:r 0 ; onb:prio 1 .`, /"a" has no onb:cue/));
  it("refuses a requirement that names no tile", () =>
    refuses(tile("a", "; onb:requiresAll :ghost"), /requires "ghost"/));
  it("refuses a word that isn't declared", () =>
    refuses(tile("a", "; onb:unlocksWord :ghost"), /unlocks "ghost"/));
  it("refuses two tiles in one hex", () =>
    refuses(tile("a") + tile("b"), /"a" and "b" share the hex/));

  it("refuses a dependency cycle, and a tree with no way in", () => {
    refuses(tile("a", "; onb:requiresAll :b", 0, 0) + tile("b", "; onb:requiresAll :a", 1, 0), /No tile can open/);
    refuses(tile("a", "", 0, 0) + tile("b", "; onb:requiresAll :c", 1, 0) + tile("c", "; onb:requiresAll :b", 2, 0), /"b" can never open/);
  });
  it("lets a tile require an emergent one: it can be done by data, never opened", () => {
    expect(() => parseTree(HEAD + tile("a") + tile("e", "; onb:emergent true", 1, 0) + tile("b", "; onb:requiresAll :e", 2, 0))).not.toThrow();
  });
  it("refuses a blank or fractional number, and two ids that collapse into one", () => {
    refuses(`:a a onb:Tile ; onb:title "A" ; onb:cue "C" ; onb:q "" ; onb:r 0 ; onb:prio 1 .`, /onb:q is not a number/);
    refuses(`:a a onb:Tile ; onb:title "A" ; onb:cue "C" ; onb:q 1.5 ; onb:r 0 ; onb:prio 1 .`, /whole number/);
    refuses(
      tile("a", "", 0, 0) + `<https://other.example/x#a> a onb:Tile ; onb:title "A2" ; onb:cue "C2" ; onb:q 1 ; onb:r 0 ; onb:prio 1 .`,
      /Two tiles are called "a"/
    );
  });
  it("keeps only real Bernard lines: say, said, sayNext…, not sayso", () => {
    const t = parseTree(HEAD + tile("a", '; onb:say "x" ; onb:sayNext "y" ; onb:sayso "no" ; onb:saying "no"')).tiles[0];
    expect(Object.keys(t.lines).sort()).toEqual(["say", "sayNext"]);
  });

  it("reads an untagged line when no English one exists", () => {
    const t = parseTree(HEAD + `:a a onb:Tile ; onb:title "A" ; onb:cue "C" ; onb:q 0 ; onb:r 0 ; onb:prio 1 ;
      onb:say "plain" ; onb:saidDone "fr"@fr , "en"@en .`).tiles[0];
    expect(t.title).toBe("A");
    expect(t.lines).toEqual({ say: "plain", saidDone: "en" });
  });
});

describe("fog rules (AC3)", () => {
  const view = (...done: string[]) => tileStates(tree.tiles, new Set(done));
  const ids = (states: Map<string, TileState>, s: TileState) =>
    [...states].filter(([, v]) => v === s).map(([k]) => k);

  it("starts with one obvious step, and a hint of the next", () => {
    const s = view();
    expect(ids(s, "open")).toEqual(["describe"]);
    expect(ids(s, "cue")).toEqual(["keep"]);
    expect(tally(s)).toEqual({ cleared: 0, open: 1 });
  });

  it(`opens at most ${MAX_OPEN} by prio; the rest say ready`, () => {
    const s = view("describe", "keep");
    expect(ids(s, "open")).toEqual(["change", "join", "event"]);
    expect(ids(s, "ready")).toEqual(["second", "handover"]);
    expect(tally(s)).toEqual({ cleared: 2, open: 3 });
  });

  it("shows a tile next to something open as a cue, the rest stay fog", () => {
    const s = view("describe", "keep");
    expect(s.get("answer")).toBe("cue"); // needs change, which is open
    expect(s.get("agenda")).toBe("cue"); // needs join and event, both open
    expect(s.get("peers")).toBe("cue"); // needs join
    expect(s.get("discord")).toBe("fog"); // needs answer, still a cue
  });

  it("never opens an emergent or planned tile", () => {
    const all = tree.tiles.map((t) => t.id).filter((id) => !["discord", "mentor", "bridge"].includes(id));
    const s = view(...all);
    expect(s.get("discord")).toBe("cue");
    expect(s.get("mentor")).toBe("cue");
    expect(s.get("bridge")).toBe("cue");
    expect(ids(s, "open")).toEqual([]);
  });

  it("lets a tile that can complete take an open slot before a stub does", () => {
    const t = (id: string, prio: number, all: string[] = []): Tile => ({
      ...tree.tiles[0], id, requiresAll: all, requiresAny: [], emergent: false, planned: false, prio,
    });
    const tiles = [t("root", 0), t("s1", 1, ["root"]), t("s2", 2, ["root"]), t("s3", 3, ["root"]), t("real", 4, ["root"])];
    const done = new Set(["root"]);
    expect(tileStates(tiles, done).get("real")).toBe("ready"); // prio only: starved
    const s = tileStates(tiles, done, new Set(["root", "real"]));
    expect(s.get("real")).toBe("open");
    expect(s.get("s3")).toBe("ready");
  });

  it("opens on any one of requiresAny", () => {
    const t = (id: string, any: string[] = []): Tile => ({
      ...tree.tiles[0], id, requiresAll: [], requiresAny: any, emergent: false, planned: false, prio: 1,
    });
    const tiles = [t("a"), t("b"), t("c", ["a", "b"])];
    expect(tileStates(tiles, new Set(["b"])).get("c")).toBe("open");
    expect(tileStates(tiles, new Set()).get("c")).toBe("cue");
  });
});

describe("loadTree", () => {
  const answer = (body: string, status = 200) =>
    (async () => new Response(body, { status })) as unknown as typeof fetch;

  it("parses what the server sends", async () => {
    expect((await loadTree("/onboarding.ttl", answer(TTL))).tiles).toHaveLength(13);
  });
  it("turns a 404 into a TreeError", async () => {
    await expect(loadTree("/onboarding.ttl", answer("", 404))).rejects.toThrowError(/answered 404/);
  });
  it("turns a network failure into a TreeError", async () => {
    const down = (async () => { throw new TypeError("Failed to fetch"); }) as unknown as typeof fetch;
    await expect(loadTree("/onboarding.ttl", down)).rejects.toBeInstanceOf(TreeError);
  });
});
