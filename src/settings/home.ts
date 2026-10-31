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
 * unseen. If the profile has a private Type Index, the file is registered
 * there so other apps can find it; `pim:preferencesFile` is left to the pod
 * (decided 2026-10-30).
 */
import { DataFactory, Parser, Writer } from "n3";
import { authFetch } from "../lib/auth";
import { updateDocument, type ConditionalError } from "../lib/conditional";
import { readTurtle } from "../lib/read";
import { SESSION_ID } from "../config";
import { ONB } from "../tree/parse";

const { namedNode, literal, quad } = DataFactory;
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const XSD_BOOLEAN = "http://www.w3.org/2001/XMLSchema#boolean";
const SOLID = "http://www.w3.org/ns/solid/terms#";
const PIM = "http://www.w3.org/ns/pim/space#";

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
    await registerInTypeIndex(webId, url).catch((e) =>
      console.warn("settings/mom-home.ttl was written but not registered in the Type Index:", e)
    );
  }
}

export const SETTINGS_README = `# settings

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

/** Writes `settings/README.md` unless something is already there: once there, it is yours. */
export async function ensureSettingsReadme(podRoot: string): Promise<void> {
  const res = await authFetch(podRoot + "settings/README.md", {
    method: "PUT",
    headers: { "Content-Type": "text/markdown", "If-None-Match": "*" },
    body: SETTINGS_README,
  });
  // 412: already there. Nothing depends on the README: never stop a write for it.
  if (!res.ok && res.status !== 412) console.warn(`Could not write the settings README (${res.status}).`);
}

/** The documents followed from a profile stay on the profile's own origin (or the pod's): the session's credentials go nowhere else. */
async function objectOf(docUrl: string, subject: string, predicate: string, origins: string[]): Promise<string | null> {
  if (!origins.includes(new URL(docUrl).origin)) {
    console.warn(`Not following ${docUrl}: outside ${origins.join(", ")}.`);
    return null;
  }
  const res = await readTurtle(docUrl);
  if (!res.ok) return null;
  const quads = new Parser({ baseIRI: docUrl }).parse(await res.text());
  return quads.find((q) => q.subject.value === subject && q.predicate.value === predicate)?.object.value ?? null;
}

/** The private Type Index: named in the profile, or in the preferences file it points to. */
export async function findPrivateTypeIndex(webId: string, origins = [new URL(webId).origin]): Promise<string | null> {
  const profile = webId.split("#")[0];
  const direct = await objectOf(profile, webId, SOLID + "privateTypeIndex", origins);
  if (direct) return direct;
  const prefs = await objectOf(profile, webId, PIM + "preferencesFile", origins);
  return prefs ? objectOf(prefs.split("#")[0], webId, SOLID + "privateTypeIndex", origins) : null;
}

/** Turtle to append to a Type Index: full IRIs, so it doesn't depend on the file's prefixes. */
export function registrationTurtle(indexUrl: string, instance: string): string {
  return `\n<${indexUrl}#mom-home-settings> <${RDF_TYPE}> <${SOLID}TypeRegistration> ;\n  <${SOLID}forClass> <${T.HomeSettings}> ;\n  <${SOLID}instance> <${instance}> .\n`;
}

/** Registers the file in the private Type Index, once; no index: nothing to do. */
export async function registerInTypeIndex(webId: string, instance: string): Promise<void> {
  const origins = [...new Set([new URL(webId).origin, new URL(instance).origin])];
  const index = await findPrivateTypeIndex(webId, origins);
  if (!index) return;
  const url = index.split("#")[0];
  if (!origins.includes(new URL(url).origin)) return;
  await updateDocument(url, (text) => {
    const quads = new Parser({ baseIRI: url }).parse(text);
    const listed = quads.some((q) => q.predicate.value === SOLID + "instance" && q.object.value === instance);
    if (listed) return text;
    const next = text.replace(/\s*$/, "\n") + registrationTurtle(url, instance);
    // A file that ended mid-statement would swallow the registration into it,
    // and this is a document other apps depend on: check before writing.
    const parsed = new Parser({ baseIRI: url }).parse(next);
    const ok = parsed.some((q) => q.subject.value === `${url}#mom-home-settings` && q.object.value === instance);
    if (!ok) throw new Error(`${url} would not read as expected after the addition; left as it is.`);
    return next;
  });
}
