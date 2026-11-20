/**
 * One copy of the words (Story 14.2 AC8): every line tile A shows is in
 * `public/onboarding.ttl`, and the tree's lines keep the voice rules. Ported
 * from maps_of_making `tests/test_bernard_voice_completeness.py`, which checks
 * genjson's YAML; genjson retires in 14.8, the rules carry on here.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FIELD_KEYS, UI_KEYS } from "../workbench/describe";
import { PUBLISH_UI_KEYS } from "../workbench/publish";
import { THRESHOLD_UI_KEYS } from "../workbench/threshold";
import { HOURS_UI_KEYS } from "../workbench/hours";
import { LOGO_UI_KEYS } from "../workbench/logo";
import { MOVE_UI_KEYS } from "../workbench/move";
import { PROFILE_UI_KEYS } from "../workbench/tool";
import { WELCOME_UI_KEYS } from "../workbench/welcome";

/** What tile B shows signed out and signed in: every line it uses is in the tree, and nothing else is. */
const TILE_B_KEYS: readonly string[] = [...THRESHOLD_UI_KEYS, ...PUBLISH_UI_KEYS];
import { parseTree } from "./parse";

const tree = parseTree(readFileSync(join(__dirname, "../../public/onboarding.ttl"), "utf8"));
const describeTile = tree.tiles.find((t) => t.act === "describe")!;
const thresholdTile = tree.tiles.find((t) => t.act === "threshold")!;

/** genjson's list (test_bernard_voice_completeness.py): judging, cheering, nudging. */
const FORBIDDEN = ["most spaces leave this blank", "keep it simple", "you can do better", "well done", "great job"];

/** Every line the tree holds, with where it is. */
function everyLine(): [string, string][] {
  const out: [string, string][] = [];
  const add = (where: string, text: string | null | undefined) => text && out.push([where, text]);
  for (const [k, v] of Object.entries(tree.app.lines)) add(`app.${k}`, v);
  for (const [k, v] of Object.entries(tree.app.ui)) add(`app.${k}`, v);
  for (const t of tree.tiles) {
    add(`${t.id}.title`, t.title);
    add(`${t.id}.cue`, t.cue);
    add(`${t.id}.lead`, t.lead);
    add(`${t.id}.leadShort`, t.leadShort);
    for (const [k, v] of Object.entries(t.lines)) add(`${t.id}.${k}`, v);
    for (const [k, v] of Object.entries(t.ui)) add(`${t.id}.${k}`, v);
    // The network's variants keep the same voice (2026-11-19).
    const n = t.network;
    add(`${t.id}.title.network`, n?.title);
    add(`${t.id}.cue.network`, n?.cue);
    add(`${t.id}.lead.network`, n?.lead);
    add(`${t.id}.leadShort.network`, n?.leadShort);
    for (const [k, v] of Object.entries(n?.lines ?? {})) add(`${t.id}.${k}.network`, v);
    for (const [k, v] of Object.entries(n?.ui ?? {})) add(`${t.id}.${k}.network`, v);
    for (const [k, f] of Object.entries(t.fields)) {
      add(`${t.id}.field.${k}.label`, f.label);
      add(`${t.id}.field.${k}.hint`, f.hint);
      add(`${t.id}.field.${k}.placeholder`, f.placeholder);
    }
  }
  for (const x of [...tree.profile.sections, ...tree.profile.fields, ...tree.profile.contactTypes]) {
    for (const [k, v] of Object.entries(x.network ?? {})) add(`profile.${"key" in x ? x.key : x.id}.${k}.network`, v);
  }
  for (const w of tree.words) add(`word.${w.id}`, w.meaning);
  return out;
}

describe("the tree's words (14.2 AC8)", () => {
  it("has every line tile A shows", () => {
    expect(UI_KEYS.filter((k) => !(k in describeTile.ui))).toEqual([]);
    expect(FIELD_KEYS.filter((k) => !(k in describeTile.fields))).toEqual([]);
    // And nothing tile A no longer uses, so the tree doesn't drift into dead lines.
    expect(Object.keys(describeTile.ui).filter((k) => !(UI_KEYS as readonly string[]).includes(k))).toEqual([]);
    expect(Object.keys(describeTile.fields).filter((k) => !FIELD_KEYS.includes(k))).toEqual([]);
  });

  it("has every line tile B shows, and nothing it no longer uses (14.3 AC8)", () => {
    expect(TILE_B_KEYS.filter((k) => !(k in thresholdTile.ui))).toEqual([]);
    expect(Object.keys(thresholdTile.ui).filter((k) => !TILE_B_KEYS.includes(k))).toEqual([]);
  });

  it("has every line tile C shows, and nothing it no longer uses (14.6)", () => {
    const changeTile = tree.tiles.find((t) => t.act === "hours")!;
    const keys: readonly string[] = [...HOURS_UI_KEYS, ...LOGO_UI_KEYS, ...MOVE_UI_KEYS, ...PROFILE_UI_KEYS];
    expect(keys.filter((k) => !(k in changeTile.ui))).toEqual([]);
    expect(Object.keys(changeTile.ui).filter((k) => !keys.includes(k))).toEqual([]);
  });

  it("has every line the welcome tile shows, and nothing it no longer uses (#69)", () => {
    const welcomeTile = tree.tiles.find((t) => t.act === "welcome")!;
    const keys: readonly string[] = WELCOME_UI_KEYS;
    expect(keys.filter((k) => !(k in welcomeTile.ui))).toEqual([]);
    expect(Object.keys(welcomeTile.ui).filter((k) => !keys.includes(k))).toEqual([]);
    expect(Object.keys(welcomeTile.lines).sort()).toEqual(["saidDone", "say"]);
  });

  // A network's variant is the space's line said differently: the key sets above lock the space's lines, and a
  // variant is only ever a base key (derived, not listed), so a line nobody shows can't hide behind a suffix.
  it("has a space line behind every network variant, and the same placeholders", () => {
    const orphans: string[] = [];
    const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    const drifted: string[] = [];
    for (const t of tree.tiles) {
      const n = t.network;
      if (!n) continue;
      for (const [k, v] of Object.entries(n.lines)) {
        if (!(k in t.lines)) orphans.push(`${t.id}.${k}`);
        else if (placeholders(v).join() !== placeholders(t.lines[k]).join()) drifted.push(`${t.id}.${k}`);
      }
      for (const [k, v] of Object.entries(n.ui)) {
        if (!(k in t.ui)) orphans.push(`${t.id}.${k}`);
        else if (placeholders(v).join() !== placeholders(t.ui[k]).join()) drifted.push(`${t.id}.${k}`);
      }
      if (n.lead && !t.lead) orphans.push(`${t.id}.lead`);
      if (n.leadShort && !t.leadShort) orphans.push(`${t.id}.leadShort`);
    }
    expect(orphans).toEqual([]);
    expect(drifted).toEqual([]);
  });

  it("refuses a network variant with no space line", () => {
    const turtle = readFileSync(join(__dirname, "../../public/onboarding.ttl"), "utf8");
    expect(() => parseTree(turtle.replace("onb:uiDoorPodDescForNetwork", "onb:uiDoorNothingForNetwork"))).toThrow(/no onb:uiDoorNothing for a space/);
  });

  it("never judges, cheers or nudges", () => {
    const hits = everyLine().filter(([, text]) => FORBIDDEN.some((f) => text.toLowerCase().includes(f)));
    expect(hits).toEqual([]);
  });

  it("uses no em-dash (the voice rule; the page draws Bernard's own)", () => {
    expect(everyLine().filter(([, text]) => text.includes("—"))).toEqual([]);
  });

  it("names Bernard's pronouns once, where they introduce themselves", () => {
    const named = everyLine().filter(([, text]) => text.includes("they/them"));
    expect(named.map(([where]) => where)).toEqual(["describe.saidDone"]);
  });
});
