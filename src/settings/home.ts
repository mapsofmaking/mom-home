/**
 * `settings/mom-home.ttl` (named after the app's SESSION_ID, so a fork for
 * another vertical gets its own file): what the home app remembers for the
 * person signed in, that the pod can't say by itself (Story 14.1 AC4).
 * Settings follow the person, done follows a space: the signer may be a
 * person coordinating several spaces, or a space's own account
 * (docs/explanation/home-people-and-spaces.md in maps_of_making). Done is never kept here: it is
 * derived from the space's own data (src/tiles/done.ts). Only what nothing
 * else records: the hex panel's fold, and which tutorials were seen (a tile's
 * first open is its tutorial; the next opens go straight to its tool).
 *
 * The solid-backoffice pattern (`settings/collectives.ttl`): created on first
 * need, only if nobody created it meanwhile (`If-None-Match: *`), with
 * `settings/README.md` beside it, never over one already there; every change
 * after that is one conditional whole-document write (`updateDocument`: read,
 * change, `If-Match`), so a second tab or another app is never overwritten
 * unseen. The file is registered in the private Type Index so the owner's other
 * apps can find it (lib/typeindex.ts; the indexes are made when the pod lacks them).
 */
import { DataFactory, Parser, Writer } from "n3";
import { authFetch } from "../lib/auth";
import { updateDocument, type ConditionalError } from "../lib/conditional";
import { readTurtle } from "../lib/read";
import { ensureIndexes, registerType } from "../lib/typeindex";
import { SESSION_ID } from "../config";
import { FOOTPRINT, type FootprintMark } from "../lib/footprint";
import { ONB } from "../tree/parse";

const { namedNode, literal, quad } = DataFactory;
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const XSD_BOOLEAN = "http://www.w3.org/2001/XMLSchema#boolean";

const T = {
  HomeSettings: ONB + "HomeSettings",
  folded: ONB + "folded",
  seenTutorial: ONB + "seenTutorial",
};

export interface HomeSettings {
  /** The hex panel's fold; null = never set. */
  folded: boolean | null;
  /** IRIs of the tiles whose tutorial was seen. */
  seen: string[];
}

export const EMPTY: HomeSettings = { folded: null, seen: [] };

/** The app's own file in the shared settings/ folder: never a generic name another app could pick. */
export const SETTINGS_FILE = `${SESSION_ID}.ttl`;

export function homeSettingsUrl(podRoot: string): string {
  // A pod root without its closing slash would glue "settings/" onto the last name.
  return (podRoot.endsWith("/") ? podRoot : podRoot + "/") + "settings/" + SETTINGS_FILE;
}

/** The file is there but this app can't read it, and so won't rewrite it. */
export class SettingsUnreadable extends Error {
  name = "SettingsUnreadable";
}

function parseQuads(text: string, url: string) {
  try {
    return new Parser({ baseIRI: url }).parse(text);
  } catch (e) {
    throw new SettingsUnreadable(`${url} is not valid Turtle: ${(e as Error).message}`);
  }
}

export function parseHomeSettings(text: string, url: string): HomeSettings {
  const quads = parseQuads(text, url);
  const me = quads.find((q) => q.predicate.value === RDF_TYPE && q.object.value === T.HomeSettings)?.subject.value;
  if (!me) {
    // Something is there, but not ours: rewriting would destroy it.
    if (quads.length) throw new SettingsUnreadable(`${url} has no onb:HomeSettings; left as it is.`);
    return { ...EMPTY, seen: [] };
  }
  const of = (p: string) => quads.filter((q) => q.subject.value === me && q.predicate.value === p);
  const folded = of(T.folded)[0]?.object.value;
  return {
    folded: folded === "true" ? true : folded === "false" ? false : null,
    seen: [...new Set(of(T.seenTutorial).map((q) => q.object.value))].sort(),
  };
}

/**
 * `existing`: the file as it is now. What this app doesn't own (another app's
 * triples, a newer version's fields, hand edits) is written back untouched;
 * only the type, `onb:folded` and `onb:seenTutorial` of the settings subject
 * are replaced.
 */
export function serializeHomeSettings(settings: HomeSettings, url: string, existing = ""): string {
  const me = namedNode(url + "#settings");
  const writer = new Writer({ prefixes: { onb: ONB, xsd: "http://www.w3.org/2001/XMLSchema#" } });
  const owned = new Set([RDF_TYPE, T.folded, T.seenTutorial]);
  if (existing.trim()) {
    for (const q of parseQuads(existing, url)) {
      if (q.subject.value === me.value && owned.has(q.predicate.value)) continue;
      writer.addQuad(q);
    }
  }
  writer.addQuad(quad(me, namedNode(RDF_TYPE), namedNode(T.HomeSettings)));
  if (settings.folded !== null) {
    writer.addQuad(quad(me, namedNode(T.folded), literal(String(settings.folded), namedNode(XSD_BOOLEAN))));
  }
  for (const iri of [...new Set(settings.seen)].sort()) {
    writer.addQuad(quad(me, namedNode(T.seenTutorial), namedNode(iri)));
  }
  let out = "";
  writer.end((_err, result) => {
    out = result ?? "";
  });
  return "# What Maps of Making home remembers for you. Change it from the app.\n" + out;
}

/** The settings, from the pod; none yet: the defaults. */
export async function readHomeSettings(podRoot: string): Promise<HomeSettings> {
  const url = homeSettingsUrl(podRoot);
  const res = await readTurtle(url);
  if (res.status === 404) return { ...EMPTY, seen: [] };
  if (!res.ok) throw new Error(`Could not read ${url} (${res.status}).`);
  return parseHomeSettings(await res.text(), url);
}

/**
 * One change, in one conditional write. `change` gets the settings as they
 * are on the pod now and must be repeatable: on a 412 it runs again on the
 * newer ones. First write: the file, then the README, then the Type Index.
 */
export async function changeHomeSettings(
  podRoot: string,
  webId: string,
  change: (current: HomeSettings) => HomeSettings,
  attempt = 0
): Promise<void> {
  const url = homeSettingsUrl(podRoot);
  try {
    await updateDocument(url, (text) => serializeHomeSettings(change(parseHomeSettings(text, url)), url, text));
  } catch (err) {
    const e = err as ConditionalError;
    // Only "the file isn't there" creates it; any other 404 is not ours to answer.
    if (!(e.code === "read-failed" && e.status === 404)) throw err;
    const res = await authFetch(url, {
      method: "PUT",
      headers: { "Content-Type": "text/turtle", "If-None-Match": "*" },
      body: serializeHomeSettings(change({ ...EMPTY, seen: [] }), url),
    });
    // Created meanwhile, by another tab: change that one instead. Once: a
    // second 412 on a file that reads as missing is a server we can't trust.
    if (res.status === 412 && attempt < 1) return changeHomeSettings(podRoot, webId, change, attempt + 1);
    if (!res.ok) throw new Error(`Could not create ${url} (${res.status}).`);
    // The settings are written: nothing after this may report them as lost.
    await ensureSettingsReadme(podRoot).catch((e) => console.warn("Could not write the settings README:", e));
    await registerInTypeIndex(webId, url, podRoot).catch((e) =>
      console.warn("settings/mom-home.ttl was written but not registered in the Type Index:", e)
    );
  }
}

/** What home wrote before #48: a README still saying exactly this is home's to bring up to date. */
export const README_V1 = `# settings

Apps keep what they remember for you in this folder: your preferences, the
lists they keep for you, where your data lives for them. It is on your pod so
it stays yours, and so that any app you trust can read the same thing.

Changing or deleting a file here can break the app that wrote it. Change these
settings from the apps themselves.

Maps of Making home (home.mapsofmaking.org) keeps one file here:

- \`${SETTINGS_FILE}\`: whether you keep "What you can do" folded, and which tile
  tutorials you have already seen. What your space has done is never kept
  here: the app reads it from the space's own data.
`;

const START = `<!-- ${SESSION_ID}: start -->`;
const END = `<!-- ${SESSION_ID}: end -->`;

const line = (m: FootprintMark) => `- ${m.where}: ${m.what}.`;
const of = (kind: FootprintMark["kind"]) => FOOTPRINT.filter((m) => m.kind === kind).map(line).join("\n");

/** Home's section: what it keeps on this pod, from lib/footprint.ts. Rewritten by home, between its two markers only. */
export const README_SECTION = `${START}
## Maps of Making home (home.mapsofmaking.org)

Home keeps this section up to date. What it put on your pod (paths from your
pod's root):

${of("own")}

Its entries in files other apps share too:

${of("entry")}

If your pod had none, home also made the standard files and links every Solid
app uses. They are your pod's now, not home's: leaving home doesn't remove them.

${of("plumbing")}

Outside your pod:

${of("outside")}
${END}`;

/** The README home writes when there is none: what this folder is, the files every app shares, then home's section. */
export const SETTINGS_README = `# settings

Apps keep what they remember for you in this folder: your preferences, the
lists they keep for you, where your data lives for them. It is on your pod so
it stays yours, and so that any app you trust can read the same thing.

Changing or deleting a file here can break the app that wrote it. Change these
settings from the apps themselves.

## Shared by every app

- \`prefs.ttl\`: your private preferences. It names your private Type Index.
- \`publicTypeIndex.ttl\`: what your pod makes findable by anyone, by type.
- \`privateTypeIndex.ttl\`: the same, for you and the apps you trust.

Your profile links to them. Every app that follows the Solid conventions uses
them, so they stay even when an app goes: an app removes only its own entries.

Each app that keeps something here has a section below.

${README_SECTION}
`;

/**
 * The README as it should be, from what is there now; null: leave it alone.
 * None yet, or still home's first version: home's whole README. Home's section
 * there: only that section, between its markers. A README without one (another
 * app's, or the owner's): home's section added at the end, nothing else
 * changed. Markers home can't make sense of: left alone.
 */
export function nextReadme(current: string | null): string | null {
  if (current === null || current.trim() === README_V1.trim()) return SETTINGS_README;
  const start = current.indexOf(START);
  const end = current.indexOf(END);
  const once = (mark: string, at: number) => at >= 0 && current.indexOf(mark, at + 1) < 0;
  if (start < 0 && end < 0) return current.replace(/\s*$/, "\n\n") + README_SECTION + "\n";
  if (!once(START, start) || !once(END, end) || end < start) return null;
  const next = current.slice(0, start) + README_SECTION + current.slice(end + END.length);
  return next === current ? null : next;
}

/**
 * Brings `settings/README.md` up to date (nextReadme), in one conditional write:
 * created only if nobody did, changed only if nobody changed it since it was
 * read. Nothing depends on the README: a refusal is a console line, never an error.
 */
export async function ensureSettingsReadme(podRoot: string): Promise<void> {
  const url = podRoot + "settings/README.md";
  const read = await authFetch(url, { cache: "no-store" });
  if (!read.ok && read.status !== 404) return console.warn(`Could not read the settings README (${read.status}).`);
  const current = read.ok ? await read.text() : null;
  const etag = read.ok ? read.headers.get("ETag") : null;
  const next = nextReadme(current);
  if (next === null) return;
  // Without the read's ETag the change can't be conditional: it would land over an edit it never saw.
  if (current !== null && !etag) return console.warn("The settings README came without an ETag: left alone.");
  const res = await authFetch(url, {
    method: "PUT",
    headers: { "Content-Type": "text/markdown", ...(current === null ? { "If-None-Match": "*" } : { "If-Match": etag! }) },
    body: next,
  });
  // 412: someone wrote it meanwhile. The next write home makes tries again.
  if (!res.ok && res.status !== 412) console.warn(`Could not write the settings README (${res.status}).`);
}

/**
 * Registers the settings file in the private Type Index, once (lib/typeindex.ts):
 * the indexes are made and linked first when the pod lacks them, insert-only on
 * the profile (docs/decisions.md, 2026-11-03).
 */
export async function registerInTypeIndex(webId: string, instance: string, podRoot: string): Promise<void> {
  const { privateIndex } = await ensureIndexes(webId, podRoot);
  await registerType(privateIndex, T.HomeSettings, instance, "mom-home-settings");
}
