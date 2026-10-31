/**
 * `settings/home.ttl`: what the home app remembers for a coordinator that the
 * pod can't say by itself (Story 14.1 AC4). Done is never kept here: it is
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

export function homeSettingsUrl(podRoot: string): string {
  return podRoot + "settings/home.ttl";
}

export function parseHomeSettings(text: string, url: string): HomeSettings {
  const quads = new Parser({ baseIRI: url }).parse(text);
  const me = quads.find((q) => q.predicate.value === RDF_TYPE && q.object.value === T.HomeSettings)?.subject.value;
  if (!me) return { ...EMPTY, seen: [] };
  const of = (p: string) => quads.filter((q) => q.subject.value === me && q.predicate.value === p);
  const folded = of(T.folded)[0]?.object.value;
  return {
    folded: folded === "true" ? true : folded === "false" ? false : null,
    seen: [...new Set(of(T.seenTutorial).map((q) => q.object.value))].sort(),
  };
}

export function serializeHomeSettings(settings: HomeSettings, url: string): string {
  const me = namedNode(url + "#settings");
  const writer = new Writer({ prefixes: { onb: ONB, xsd: "http://www.w3.org/2001/XMLSchema#" } });
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
  change: (current: HomeSettings) => HomeSettings
): Promise<void> {
  const url = homeSettingsUrl(podRoot);
  try {
    await updateDocument(url, (text) => serializeHomeSettings(change(parseHomeSettings(text, url)), url));
  } catch (err) {
    const status = (err as ConditionalError).status;
    if (status !== 404) throw err;
    const res = await authFetch(url, {
      method: "PUT",
      headers: { "Content-Type": "text/turtle", "If-None-Match": "*" },
      body: serializeHomeSettings(change({ ...EMPTY, seen: [] }), url),
    });
    // Created meanwhile, by another tab: change that one instead.
    if (res.status === 412) return changeHomeSettings(podRoot, webId, change);
    if (!res.ok) throw new Error(`Could not create ${url} (${res.status}).`);
    await ensureSettingsReadme(podRoot);
    await registerInTypeIndex(webId, url).catch((e) =>
      console.warn("settings/home.ttl was written but not registered in the Type Index:", e)
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

- \`home.ttl\`: whether you keep "What you can do" folded, and which tile
  tutorials you have already seen. What you have done is never kept here: the
  app reads it from your space's own data.
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

async function objectOf(docUrl: string, subject: string, predicate: string): Promise<string | null> {
  const res = await readTurtle(docUrl);
  if (!res.ok) return null;
  const quads = new Parser({ baseIRI: docUrl }).parse(await res.text());
  return quads.find((q) => q.subject.value === subject && q.predicate.value === predicate)?.object.value ?? null;
}

/** The private Type Index: named in the profile, or in the preferences file it points to. */
export async function findPrivateTypeIndex(webId: string): Promise<string | null> {
  const profile = webId.split("#")[0];
  const direct = await objectOf(profile, webId, SOLID + "privateTypeIndex");
  if (direct) return direct;
  const prefs = await objectOf(profile, webId, PIM + "preferencesFile");
  return prefs ? objectOf(prefs.split("#")[0], webId, SOLID + "privateTypeIndex") : null;
}

/** Turtle to append to a Type Index: full IRIs, so it doesn't depend on the file's prefixes. */
export function registrationTurtle(indexUrl: string, instance: string): string {
  return `\n<${indexUrl}#mom-home-settings> <${RDF_TYPE}> <${SOLID}TypeRegistration> ;\n  <${SOLID}forClass> <${T.HomeSettings}> ;\n  <${SOLID}instance> <${instance}> .\n`;
}

/** Registers the file in the private Type Index, once; no index: nothing to do. */
export async function registerInTypeIndex(webId: string, instance: string): Promise<void> {
  const index = await findPrivateTypeIndex(webId);
  if (!index) return;
  const url = index.split("#")[0];
  await updateDocument(url, (text) => {
    const quads = new Parser({ baseIRI: url }).parse(text);
    const listed = quads.some((q) => q.predicate.value === SOLID + "instance" && q.object.value === instance);
    return listed ? text : text.replace(/\s*$/, "\n") + registrationTurtle(url, instance);
  });
}
