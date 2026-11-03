/**
 * Type Indexes: how apps find a pod's data by type (Story 14.4 S4, #14).
 *
 * The profile names a public Type Index (`solid:publicTypeIndex`, readable by
 * anyone: what the pod makes findable, here the space file) and a preferences
 * file (`pim:preferencesFile`, private) that names the private Type Index (what
 * is the owner's alone, here home's settings). Our pod server makes all of them
 * with every new pod (solid-css-overlay 7.3.0-1); pods made before, or hosted
 * elsewhere, may have none.
 *
 * The profile rule (docs/decisions.md, 2026-11-03): home never rewrites the
 * profile. When a link is missing it ADDS it, in one insert-only N3 Patch, and
 * nothing else: the server appends, nothing can be deleted or rewritten. Only on
 * the signer's own pod (the profile on the pod's origin). Changing or removing a
 * profile line is the owner's own act, in the backoffice.
 *
 * Inside the index files, home adds only its own registrations, with
 * conditional writes, and never touches another app's. A link always points at
 * a file that exists: the files are made first, the profile linked last.
 */
import { Parser } from "n3";
import { isValidWebId } from "./acl";
import { authFetch } from "./auth";
import { updateDocument } from "./conditional";
import { makePublic } from "./publish";
import { readTurtle } from "./read";

const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const SOLID = "http://www.w3.org/ns/solid/terms#";
const PIM = "http://www.w3.org/ns/pim/space#";
export const MOM_SPACE = "https://mapsofmaking.org/ns/mom#Space";

export const PUBLIC_INDEX_TTL = `@prefix solid: <${SOLID}>.\n\n<> a solid:TypeIndex, solid:ListedDocument.\n`;
export const PRIVATE_INDEX_TTL = `@prefix solid: <${SOLID}>.\n\n<> a solid:TypeIndex, solid:UnlistedDocument.\n`;
export const prefsTtl = (webId: string, privateIndex: string) =>
  `@prefix pim: <${PIM}>.\n@prefix solid: <${SOLID}>.\n\n<> a pim:ConfigurationFile.\n\n<${webId}> solid:privateTypeIndex <${privateIndex}>.\n`;

/** Refused before anything is written: the reason says which rule. */
export class TypeIndexRefused extends Error {
  name = "TypeIndexRefused";
}

const withRoot = (podRoot: string) => (podRoot.endsWith("/") ? podRoot : podRoot + "/");
const doc = (iri: string) => iri.split("#")[0];
const sameOrigin = (a: string, b: string) => {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
};

/** An IRI fit to be spliced into Turtle as <…>: a plain http(s) URL with nothing that could end the token. */
const safe = (iri: string | null | undefined): iri is string => !!iri && isValidWebId(iri);

/** The object of `subject predicate ?o` in a Turtle text; null when absent or unparseable. */
function objectIn(text: string, base: string, subject: string, predicate: string): string | null {
  try {
    const quads = new Parser({ baseIRI: base }).parse(text);
    return quads.find((q) => q.subject.value === subject && q.predicate.value === predicate)?.object.value ?? null;
  } catch {
    return null;
  }
}

/** A fresh, credentialed read (the base of a write is never a kept copy). null on 404. */
async function readFresh(url: string): Promise<string | null> {
  const res = await authFetch(url, { headers: { Accept: "text/turtle" }, cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw Object.assign(new Error(`Could not read ${url} (${res.status}).`), { status: res.status });
  return res.text();
}

/** Creates a document only if nobody has: an existing one is the owner's (or another app's) and stays. */
async function createIfMissing(url: string, body: string): Promise<void> {
  const res = await authFetch(url, { method: "PUT", headers: { "Content-Type": "text/turtle", "If-None-Match": "*" }, body });
  if (!res.ok && res.status !== 412) throw Object.assign(new Error(`Could not create ${url} (${res.status}).`), { status: res.status });
}

/**
 * An N3 Patch that only inserts. No `solid:deletes`, no `solid:where`: whatever
 * the document holds stays, whatever the server's state; only these statements
 * are added (or already there, which changes nothing).
 */
export function insertOnlyPatch(statements: [subject: string, predicate: string, object: string][]): string {
  for (const [s, p, o] of statements) {
    if (!safe(s) || !safe(p) || !safe(o)) throw new TypeIndexRefused(`Not an IRI that can be written safely: ${[s, p, o].join(" ")}`);
  }
  const lines = statements.map(([s, p, o]) => `    <${s}> <${p}> <${o}>.`).join("\n");
  return `@prefix solid: <${SOLID}>.\n\n_:patch a solid:InsertDeletePatch;\n  solid:inserts {\n${lines}\n  }.\n`;
}

async function patchInsertOnly(url: string, statements: [string, string, string][]): Promise<void> {
  const res = await authFetch(url, { method: "PATCH", headers: { "Content-Type": "text/n3" }, body: insertOnlyPatch(statements) });
  if (!res.ok) throw Object.assign(new Error(`Could not add to ${url} (${res.status}).`), { status: res.status });
}

export interface Indexes {
  publicIndex: string;
  privateIndex: string;
}

/**
 * Makes sure the signer's own pod has both Type Indexes, linked from the profile,
 * and returns them. Writes only what is missing: the index files and the
 * preferences file (create-only), public read on the public index (acl.ts, ADR
 * 003), then the profile and preferences links (insert-only). Refuses a profile
 * that isn't on the pod's own origin, and an existing link that points off it.
 */
export async function ensureIndexes(webId: string, podRoot: string): Promise<Indexes> {
  const root = withRoot(podRoot);
  const profile = doc(webId);
  if (!safe(webId)) throw new TypeIndexRefused(`Not a valid WebID: ${webId}`);
  if (!sameOrigin(profile, root)) throw new TypeIndexRefused(`The profile ${profile} is not on the pod ${root}: home doesn't write it.`);

  const profileText = await readFresh(profile);
  if (profileText === null) throw new TypeIndexRefused(`The profile ${profile} isn't there.`);
  const linkedPublic = objectIn(profileText, profile, webId, SOLID + "publicTypeIndex");
  const linkedPrefs = objectIn(profileText, profile, webId, PIM + "preferencesFile");
  for (const linked of [linkedPublic, linkedPrefs]) {
    if (linked && !(safe(linked) && sameOrigin(linked, root))) {
      throw new TypeIndexRefused(`The profile points at ${linked}, outside the pod: left as it is.`);
    }
  }

  const publicIndex = linkedPublic ?? `${root}settings/publicTypeIndex.ttl`;
  const prefs = linkedPrefs ?? `${root}settings/prefs.ttl`;
  const prefsText = linkedPrefs ? await readFresh(doc(prefs)) : null;
  // Named in the preferences (the usual place), or straight in the profile (older apps did that).
  const linkedPrivate =
    (prefsText ? objectIn(prefsText, doc(prefs), webId, SOLID + "privateTypeIndex") : null) ??
    objectIn(profileText, profile, webId, SOLID + "privateTypeIndex");
  if (linkedPrivate && !(safe(linkedPrivate) && sameOrigin(linkedPrivate, root))) {
    throw new TypeIndexRefused(`The preferences point at ${linkedPrivate}, outside the pod: left as it is.`);
  }
  const privateIndex = linkedPrivate ?? `${root}settings/privateTypeIndex.ttl`;

  // The files first, so a link never points at nothing.
  await createIfMissing(doc(publicIndex), PUBLIC_INDEX_TTL);
  await createIfMissing(doc(privateIndex), PRIVATE_INDEX_TTL);
  if (!prefsText) await createIfMissing(doc(prefs), prefsTtl(webId, privateIndex));
  else if (!objectIn(prefsText, doc(prefs), webId, SOLID + "privateTypeIndex")) {
    await patchInsertOnly(doc(prefs), [[webId, SOLID + "privateTypeIndex", privateIndex]]);
  }

  // Anyone can read the public index, and only that file (the settings folder stays private).
  await makePublic(doc(publicIndex), webId, {
    accept: "text/turtle",
    isTheResource: (body) => {
      try {
        return new Parser({ baseIRI: doc(publicIndex) }).parse(body).some((q) => q.predicate.value === RDF_TYPE && q.object.value === SOLID + "TypeIndex");
      } catch {
        return false;
      }
    },
  });

  // The profile last, insert-only: only the links it lacks.
  const missing: [string, string, string][] = [];
  if (!linkedPublic) missing.push([webId, SOLID + "publicTypeIndex", publicIndex]);
  if (!linkedPrefs) missing.push([webId, PIM + "preferencesFile", prefs]);
  if (missing.length) await patchInsertOnly(profile, missing);

  return { publicIndex: doc(publicIndex), privateIndex: doc(privateIndex) };
}

/** Turtle for one registration: full IRIs, so it doesn't depend on the index's prefixes. */
export function registrationTurtle(indexUrl: string, id: string, forClass: string, instance: string): string {
  return `\n<${indexUrl}#${id}> <${RDF_TYPE}> <${SOLID}TypeRegistration> ;\n  <${SOLID}forClass> <${forClass}> ;\n  <${SOLID}instance> <${instance}> .\n`;
}

/**
 * Adds one registration (`forClass` → `instance`) to an index, once. Conditional
 * (read, change, If-Match): another app's entries are never touched. A
 * registration id already taken by something else gets a suffix, never reused.
 */
export async function registerType(indexUrl: string, forClass: string, instance: string, id: string): Promise<void> {
  const url = doc(indexUrl);
  if (!safe(forClass) || !safe(instance) || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new TypeIndexRefused("Not a registration that can be written safely.");
  await updateDocument(url, (text) => {
    const quads = new Parser({ baseIRI: url }).parse(text);
    const subjects = (p: string, o: string) => new Set(quads.filter((q) => q.predicate.value === p && q.object.value === o).map((q) => q.subject.value));
    const forIt = subjects(SOLID + "forClass", forClass);
    if ([...subjects(SOLID + "instance", instance)].some((s) => forIt.has(s))) return text;
    const used = new Set(quads.map((q) => q.subject.value));
    let name = id;
    for (let n = 2; used.has(`${url}#${name}`); n++) name = `${id}-${n}`;
    const next = text.replace(/\s*$/, "\n") + registrationTurtle(url, name, forClass, instance);
    // A file that ended mid-statement would swallow the registration: check before writing.
    const ok = new Parser({ baseIRI: url }).parse(next).some((q) => q.subject.value === `${url}#${name}` && q.object.value === instance);
    if (!ok) throw new Error(`${url} would not read as expected after the addition; left as it is.`);
    return next;
  });
}

/**
 * The space files the pod's public index names, on the pod's own origin (a
 * credentialed read never follows a link elsewhere). Read-only; [] when the
 * profile has no public index or it can't be read.
 */
export async function spacesInPublicIndex(webId: string, podRoot: string): Promise<string[]> {
  const root = withRoot(podRoot);
  const profile = doc(webId);
  if (!sameOrigin(profile, root)) return [];
  const read = async (url: string) => {
    const res = await readTurtle(url);
    return res.ok ? res.text() : null;
  };
  const profileText = await read(profile);
  const index = profileText ? objectIn(profileText, profile, webId, SOLID + "publicTypeIndex") : null;
  if (!index || !sameOrigin(index, root)) return [];
  const text = await read(doc(index));
  if (!text) return [];
  try {
    const quads = new Parser({ baseIRI: doc(index) }).parse(text);
    const regs = new Set(quads.filter((q) => q.predicate.value === SOLID + "forClass" && q.object.value === MOM_SPACE).map((q) => q.subject.value));
    return quads
      .filter((q) => regs.has(q.subject.value) && q.predicate.value === SOLID + "instance")
      .map((q) => q.object.value)
      .filter((i) => safe(i) && sameOrigin(i, root));
  } catch {
    return [];
  }
}

/** The space, findable by type: the public index names its file (#14). Makes the indexes first when the pod lacks them. */
export async function registerSpace(webId: string, podRoot: string, spaceIri: string): Promise<void> {
  const { publicIndex } = await ensureIndexes(webId, podRoot);
  await registerType(publicIndex, MOM_SPACE, spaceIri, "mom-space");
}
