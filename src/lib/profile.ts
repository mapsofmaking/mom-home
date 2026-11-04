/**
 * Tile C's tool (Story 14.6 S4, #39): the whole profile, read from the space's file, checked field by field,
 * and written back in one conditional N3 Patch. Which fields exist is the tree's (`onb:ProfileField`,
 * tree/parse.ts); this file knows how each KIND is read, checked and written.
 *
 * Reading never trusts the file: other writers (the backoffice, later Bernard) may have put a value by hand.
 * Each value is checked against its kind's shape. A value that is wrong in a way that loses nothing to mend
 * (spaces around it, `be` for `BE`, a web address written as text) carries a FIX: the tool offers it, shows
 * the before and after, and writes it only on the person's Save. A value that can't be mended without a guess
 * is a PROBLEM: shown as it is, never dropped, never rewritten by this page. Nothing here writes on its own.
 *
 * Writing touches only the statements of the fields that changed: one patch, one If-Match (the ETag of the
 * read), so the file's other statements, and anything another writer added, stay. A move of the address
 * brings its pin in the same patch (lib/move.ts), so the two move together or not at all.
 */
import type { Quad, Term } from "n3";
import type { Kind, ProfileField } from "../tree/parse";
import { normalizeMatrix, normalizeUrl } from "../workbench/describe";
import { authFetch } from "./auth";
import { fail, iri as strictIri, n3Term, readSpaceFile, type SpaceRead } from "./hours";
import { checked, moveParts, nodesOf, samePlace, type Place } from "./move";
import { PublishError, send } from "./publish";
import { iri, literal, matrixLink } from "./spacefile";

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

const SCHEMA = "https://schema.org/";
const CONTACT = SCHEMA + "contactPoint";
const CONTACT_TYPE = SCHEMA + "contactType";
const CONTACT_URL = SCHEMA + "url";
const CONTACT_CLASS = SCHEMA + "ContactPoint";
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";

/** Why a value is wrong: the tool turns the code into the tree's words (`onb:uiProfile*`). */
export type Why = "spaces" | "case" | "as-text" | "scheme" | "prefix" | "room" | "empty" | "email" | "address" | "city" | "country" | "pin";

/** What the check found: nothing; a mend that loses nothing (offered); or a value that can't be mended without a guess. */
export type Issue = { type: "fix"; why: Why; fixed: string } | { type: "problem"; why: Why };

/** A simple field's value as the file holds it. */
export interface FileValue {
  /** "" when the file has no such statement. */
  text: string;
  /** A web address written as a text literal rather than an IRI. */
  literal: boolean;
  /** More than one statement: this page changes one. */
  many: boolean;
}

export interface Profile {
  /** By field key: simple kinds and the Matrix room. */
  values: ReadonlyMap<string, FileValue>;
  /** The address and pin; null with `placeProblem` when the file doesn't hold exactly one of each. */
  place: Place | null;
  placeProblem: string | null;
  /** Predicates on the space that no profile field covers: shown read-only, never touched. */
  others: string[];
}

const one = (read: SpaceRead, p: string) => read.quads.filter((q) => q.subject.value === read.subject && q.predicate.value === p);

/** The Matrix contact points on the space: their node and url. */
function matrixPoints(read: SpaceRead): { node: Term; url: Quad[] }[] {
  return one(read, CONTACT)
    .map((q) => q.object)
    .filter((node) => read.quads.some((q) => q.subject.equals(node) && q.predicate.value === CONTACT_TYPE && q.object.value === "Matrix"))
    .map((node) => ({ node, url: read.quads.filter((q) => q.subject.equals(node) && q.predicate.value === CONTACT_URL) }));
}

/** The matrix.to link back to the room as typed (spacefile.ts draftFromTurtle's way). */
function roomOf(link: string): string {
  const room = /^https:\/\/matrix\.to\/#\/(.+)$/.exec(link)?.[1];
  if (!room) return link;
  try {
    return decodeURIComponent(room);
  } catch {
    return link;
  }
}

/** What the file says for each field the tree lists. */
export function readProfile(read: SpaceRead, fields: readonly ProfileField[]): Profile {
  const values = new Map<string, FileValue>();
  const covered = new Set<string>([RDF_TYPE, SCHEMA + "address", SCHEMA + "geo", CONTACT]);
  for (const f of fields) {
    if (f.property) {
      covered.add(f.property);
      const found = one(read, f.property);
      values.set(f.key, { text: found[0]?.object.value ?? "", literal: found[0]?.object.termType === "Literal", many: found.length > 1 });
    } else if (f.kind === "matrix") {
      const points = matrixPoints(read);
      const url = points[0]?.url[0]?.object.value ?? "";
      values.set(f.key, { text: url ? roomOf(url) : "", literal: false, many: points.length > 1 || (points[0]?.url.length ?? 0) > 1 });
    }
  }
  let place: Place | null = null;
  let placeProblem: string | null = null;
  if (fields.some((f) => f.kind === "place")) {
    try {
      place = nodesOf(read).was;
    } catch (err) {
      placeProblem = (err as Error).message;
    }
  }
  const others = [...new Set(read.quads.filter((q) => q.subject.value === read.subject && !covered.has(q.predicate.value)).map((q) => q.predicate.value))];
  return { values, place, placeProblem, others };
}

const URLISH = /^[^\s/@]+\.[^\s/@]+/;

/** Checks one simple or Matrix field's text, as the file holds it or as typed. */
export function check(kind: Kind, text: string, opts: { required?: boolean; literal?: boolean } = {}): Issue | null {
  const t = text.trim();
  if (!t) return opts.required ? { type: "problem", why: "empty" } : null;
  const spaced: Issue | null = t !== text ? { type: "fix", why: "spaces", fixed: t } : null;
  switch (kind) {
    case "text":
      return spaced;
    case "email": {
      const bare = t.replace(/^mailto:/i, "");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(bare)) return { type: "problem", why: "email" };
      return bare !== text ? { type: "fix", why: bare !== t ? "prefix" : "spaces", fixed: bare } : null;
    }
    case "url":
    case "image": {
      if (/^https?:\/\//i.test(t)) {
        if (!iri(t)) return { type: "problem", why: "address" };
        // A web address as text: the same address as an IRI, which is what readers expect.
        return opts.literal ? { type: "fix", why: "as-text", fixed: t } : spaced;
      }
      const fixed = normalizeUrl(t);
      return fixed !== t && URLISH.test(t) && iri(fixed) ? { type: "fix", why: "scheme", fixed } : { type: "problem", why: "address" };
    }
    case "matrix": {
      if (matrixLink(t)) return spaced;
      const fixed = normalizeMatrix(t);
      return fixed !== t && matrixLink(fixed) ? { type: "fix", why: "room", fixed } : { type: "problem", why: "room" };
    }
    case "place":
      return null;
  }
}

/** The address and pin, checked: a town, a two-letter upper-case country, coordinates on the globe. */
export function checkPlace(place: Place): Issue | null {
  if (!place.city.trim()) return { type: "problem", why: "city" };
  if (!/^[A-Z]{2}$/.test(place.country)) return /^[A-Za-z]{2}$/.test(place.country.trim()) ? { type: "fix", why: "case", fixed: place.country.trim().toUpperCase() } : { type: "problem", why: "country" };
  if (!Number.isFinite(place.lat) || !Number.isFinite(place.lon) || Math.abs(place.lat) > 90 || Math.abs(place.lon) > 180) return { type: "problem", why: "pin" };
  return null;
}

/** One field that changed: what the file says, what it will say. null: none / removed. */
export interface Change {
  key: string;
  was: string | null;
  now: string | null;
}

/** The fields whose typed text differs from the file, in the tree's order. A web address held as text counts as changed: saving mends it. */
export function changes(fields: readonly ProfileField[], profile: Profile, typed: Readonly<Record<string, string>>, place?: Place): Change[] {
  const out: Change[] = [];
  for (const f of fields) {
    if (f.kind === "place") {
      if (place && profile.place && !samePlace(profile.place, checked(place))) out.push({ key: f.key, was: placeLine(profile.place), now: placeLine(checked(place)) });
      continue;
    }
    if (!(f.key in typed)) continue;
    const have = profile.values.get(f.key) ?? { text: "", literal: false, many: false };
    const urlish = f.kind === "url" || f.kind === "image";
    let now = typed[f.key].trim();
    if (urlish && now) {
      // What the file will hold: the address as a URL writes it (spaces and brackets encoded), or nothing this file will carry.
      const canon = iri(now);
      if (!canon) throw new PublishError("incomplete", `That isn't a web address this file can carry (${f.label}).`);
      now = canon.slice(1, -1);
    }
    if (now !== have.text || (urlish && have.literal && now) || (have.many && now)) out.push({ key: f.key, was: have.text || null, now: now || null });
  }
  return out;
}

/** "158 Rue Gray, 1050 Ixelles, BE" */
export const placeLine = (p: Place) => [p.street, [p.postcode, p.city].filter(Boolean).join(" "), p.country].filter(Boolean).join(", ");

/** The patch for these changes: one where (the nodes and values read), the statements that go, the ones that come. */
export function profilePatch(read: SpaceRead, fields: readonly ProfileField[], list: readonly Change[], place?: Place): string {
  const s = strictIri(read.subject);
  const where: string[] = [];
  const deletes: string[] = [];
  const inserts: string[] = [];
  for (const c of list) {
    const f = fields.find((x) => x.key === c.key)!;
    if (f.kind === "place") {
      const nodes = nodesOf(read);
      const parts = moveParts(read.subject, nodes.old, checked(place!));
      where.push(...parts.where);
      deletes.push(...parts.deletes);
      inserts.push(...parts.inserts);
    } else if (f.kind === "matrix") {
      const points = matrixPoints(read);
      if (points.length > 1 || (points[0]?.url.length ?? 0) > 1) throw new PublishError("unreadable", "The space file has more than one Matrix room; this page changes one: left alone.");
      const link = c.now ? matrixLink(c.now) : null;
      if (c.now && !link) throw new PublishError("incomplete", "That isn't a Matrix room this file can carry.");
      const point = points[0];
      if (point && point.url[0]) {
        // The point is a blank node (or named): the variable binds it, matched by its type and the url read.
        where.push(`${s} ${strictIri(CONTACT)} ?c .`, `?c ${strictIri(CONTACT_TYPE)} "Matrix" .`, `?c ${strictIri(CONTACT_URL)} ${n3Term(point.url[0].object)} .`);
        deletes.push(`?c ${strictIri(CONTACT_URL)} ${n3Term(point.url[0].object)} .`);
        if (link) inserts.push(`?c ${strictIri(CONTACT_URL)} ${link} .`);
        // Taken away entirely: the type goes with the url, so no empty contact point is left.
        else deletes.push(`?c ${strictIri(CONTACT_TYPE)} "Matrix" .`, `${s} ${strictIri(CONTACT)} ?c .`);
      } else if (link) {
        const node = strictIri(`${read.subject.split("#")[0]}#matrix`);
        inserts.push(`${s} ${strictIri(CONTACT)} ${node} .`, `${node} ${strictIri(RDF_TYPE)} ${strictIri(CONTACT_CLASS)} ; ${strictIri(CONTACT_TYPE)} "Matrix" ; ${strictIri(CONTACT_URL)} ${link} .`);
      }
    } else {
      const predicate = strictIri(f.property!);
      for (const q of one(read, f.property!)) deletes.push(`${s} ${predicate} ${n3Term(q.object)} .`);
      if (c.now) {
        const object = f.kind === "url" || f.kind === "image" ? iri(c.now) : literal(c.now);
        if (!object) throw new PublishError("incomplete", `That isn't a web address this file can carry (${f.label}).`);
        inserts.push(`${s} ${predicate} ${object} .`);
      }
    }
  }
  // A part with nothing in it is left out: an empty formula is legal Turtle but not worth asking a pod to read.
  const parts = [
    ...(where.length ? [`solid:where { ${where.join(" ")} }`] : []),
    ...(deletes.length ? [`solid:deletes { ${deletes.join(" ")} }`] : []),
    ...(inserts.length ? [`solid:inserts { ${inserts.join(" ")} }`] : []),
  ];
  return ["@prefix solid: <http://www.w3.org/ns/solid/terms#> .", "_:profile a solid:InsertDeletePatch ;", `  ${parts.join(" ;\n  ")} .`, ""].join("\n");
}

export interface SaveResult {
  /** saved: written and read back. same: the file already says all of it; nothing was written. */
  status: "saved" | "same";
  changes: Change[];
  /** The file as the pod holds it after the save (or as read, when nothing was written). */
  text: string;
  profile: Profile;
}

/**
 * The profile saved: the changed fields written to the space file at `fileUrl` in one patch, with the ETag of
 * the read. Throws a PublishError: incomplete, expired, no-control, gone, conflict, unreachable, refused,
 * unreadable, unconfirmed. `typed` holds the fields the person edited, by key; `place` the address found for
 * it (geocoded by the caller), when it changed.
 */
export async function saveProfile(
  fileUrl: string,
  fields: readonly ProfileField[],
  typed: Readonly<Record<string, string>>,
  place: Place | undefined,
  fetchImpl: Fetch = (u, i) => authFetch(u, i),
): Promise<SaveResult> {
  for (const f of fields) {
    if (f.required && f.kind !== "place" && f.key in typed && !typed[f.key].trim()) throw new PublishError("incomplete", `${f.label} can't be empty.`);
  }
  const before = await readSpaceFile(fileUrl, fetchImpl);
  const profile = readProfile(before, fields);
  const list = changes(fields, profile, typed, place);
  if (!list.length) return { status: "same", changes: [], text: before.text, profile };
  // Without the read's ETag the write can't be conditional: it would land over a change it never saw.
  if (!before.etag) throw new PublishError("refused", "The pod sent no ETag, so the write can't check the file is unchanged.");

  const body = profilePatch(before, fields, list, place);
  const res = await send(fetchImpl, fileUrl, { method: "PATCH", headers: { "Content-Type": "text/n3", "If-Match": before.etag }, body });
  if (!res.ok) fail(res, "Saving the profile");

  // The write is in: from here a failure is "not confirmed", never "nothing was written".
  let after: SpaceRead;
  let now: Profile;
  try {
    after = await readSpaceFile(fileUrl, fetchImpl);
    now = readProfile(after, fields);
  } catch (err) {
    throw new PublishError("unconfirmed", `Saved, but reading it back failed: ${(err as Error).message}`);
  }
  // Another writer may have changed it again since: what matters is that ours went in.
  const missing = changes(fields, now, Object.fromEntries(list.filter((c) => c.key !== "address").map((c) => [c.key, c.now ?? ""])), place);
  if (missing.length) throw new PublishError("unconfirmed", "Saved, but the file read back doesn't say it: it may have changed since.");
  return { status: "saved", changes: list, text: after.text, profile: now };
}
