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
import { parseTree } from "./parse";

const tree = parseTree(readFileSync(join(__dirname, "../../public/onboarding.ttl"), "utf8"));
const describeTile = tree.tiles.find((t) => t.act === "describe")!;

/** genjson's list (test_bernard_voice_completeness.py): judging, cheering, nudging. */
const FORBIDDEN = ["most spaces leave this blank", "keep it simple", "you can do better", "well done", "great job"];

/** Every line the tree holds, with where it is. */
function everyLine(): [string, string][] {
  const out: [string, string][] = [];
  const add = (where: string, text: string | null | undefined) => text && out.push([where, text]);
  for (const [k, v] of Object.entries(tree.app.lines)) add(`app.${k}`, v);
  for (const t of tree.tiles) {
    add(`${t.id}.title`, t.title);
    add(`${t.id}.cue`, t.cue);
    add(`${t.id}.lead`, t.lead);
    add(`${t.id}.leadShort`, t.leadShort);
    for (const [k, v] of Object.entries(t.lines)) add(`${t.id}.${k}`, v);
    for (const [k, v] of Object.entries(t.ui)) add(`${t.id}.${k}`, v);
    for (const [k, f] of Object.entries(t.fields)) {
      add(`${t.id}.field.${k}.label`, f.label);
      add(`${t.id}.field.${k}.hint`, f.hint);
      add(`${t.id}.field.${k}.placeholder`, f.placeholder);
    }
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
