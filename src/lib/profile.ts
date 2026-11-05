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
import type { ContactType, Kind, ProfileField } from "../tree/parse";
import { normalizeUrl } from "../workbench/describe";
import { authFetch } from "./auth";
import { fail, iri as strictIri, n3Term, readSpaceFile, type SpaceRead } from "./hours";
import { checked, moveParts, nodesOf, samePlace, type Place } from "./move";
import { PublishError, send } from "./publish";
import { iri, literal } from "./spacefile";
import { handleChanges, handleParts, readContacts, sameHandles, type Contacts, type Handle } from "./contacts";

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

const SCHEMA = "https://schema.org/";
const CONTACT = SCHEMA + "contactPoint";
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";

/** Why a value is wrong: the tool turns the code into the tree's words (`onb:uiProfile*`). */
export type Why =
  | "spaces" | "case" | "as-text" | "scheme" | "prefix" | "room" | "handle" | "empty" | "email" | "phone" | "address" | "city" | "country" | "pin";

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

/** The profile's shape, from the tree: its fields and the kinds of contact handle. */
export interface ProfileDef {
  fields: readonly ProfileField[];
  contactTypes: readonly ContactType[];
}

export interface Profile {
  /** By field key: the simple kinds. */
  values: ReadonlyMap<string, FileValue>;
  /** The address and pin; null with `placeProblem` when the file doesn't hold exactly one of each. */
  place: Place | null;
  placeProblem: string | null;
  /** The contact handles; null when no field is of kind contacts. */
  contacts: Contacts | null;
  /** Predicates on the space that no profile field covers: shown read-only, never touched. */
  others: string[];
}

const one = (read: SpaceRead, p: string) => read.quads.filter((q) => q.subject.value === read.subject && q.predicate.value === p);

/** What the file says for each field the tree lists. */
export function readProfile(read: SpaceRead, def: ProfileDef): Profile {
  const values = new Map<string, FileValue>();
  const covered = new Set<string>([RDF_TYPE, SCHEMA + "address", SCHEMA + "geo"]);
  for (const f of def.fields) {
    if (!f.property) continue;
    covered.add(f.property);
    const found = one(read, f.property);
    values.set(f.key, { text: found[0]?.object.value ?? "", literal: found[0]?.object.termType === "Literal", many: found.length > 1 });
  }
  let contacts: Contacts | null = null;
  if (def.fields.some((f) => f.kind === "contacts")) {
    contacts = readContacts(read, def.contactTypes);
    covered.add(CONTACT);
    for (const t of def.contactTypes) if (t.property) covered.add(t.property);
  }
  let place: Place | null = null;
  let placeProblem: string | null = null;
  if (def.fields.some((f) => f.kind === "place")) {
    try {
      place = nodesOf(read).was;
    } catch (err) {
      placeProblem = (err as Error).message;
    }
  }
  const others = [...new Set(read.quads.filter((q) => q.subject.value === read.subject && !covered.has(q.predicate.value)).map((q) => q.predicate.value))];
  return { values, place, placeProblem, contacts, others };
}

const URLISH = /^[^\s/@]+\.[^\s/@]+/;

/** Checks one simple field's text, as the file holds it or as typed (a contact handle: contacts.ts checkHandle). */
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
    case "contacts":
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

/** What the person changed: the simple fields' text by key, the address found, the contact handles as a whole list. */
export interface Edit {
  /** The ETag of the read the person's screen was drawn from: a file that has changed since is refused (`conflict`), never overwritten. */
  baseEtag?: string | null;
  values?: Readonly<Record<string, string>>;
  place?: Place;
  handles?: readonly Handle[];
}

const handlesLine = (def: ProfileDef, list: readonly Handle[]) =>
  list.map((h) => `${def.contactTypes.find((t) => t.key === h.type)?.label ?? h.type}: ${h.value}`).join(", ") || null;

/** The fields whose value differs from the file, in the tree's order. A web address held as text counts as changed: saving mends it. */
export function changes(def: ProfileDef, profile: Profile, edit: Edit): Change[] {
  const out: Change[] = [];
  const typed = edit.values ?? {};
  for (const f of def.fields) {
    if (f.kind === "place") {
      const place = edit.place;
      if (place && profile.place && !samePlace(profile.place, checked(place))) out.push({ key: f.key, was: placeLine(profile.place), now: placeLine(checked(place)) });
      continue;
    }
    if (f.kind === "contacts") {
      if (edit.handles && profile.contacts && !sameHandles(def.contactTypes, profile.contacts, edit.handles)) {
        out.push({ key: f.key, was: handlesLine(def, profile.contacts.handles), now: handlesLine(def, edit.handles.filter((h) => h.value.trim())) });
      }
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
export function profilePatch(read: SpaceRead, def: ProfileDef, profile: Profile, list: readonly Change[], edit: Edit): string {
  const s = strictIri(read.subject);
  const where: string[] = [];
  const deletes: string[] = [];
  const inserts: string[] = [];
  const add = (p: { where: string[]; deletes: string[]; inserts: string[] }) => {
    where.push(...p.where);
    deletes.push(...p.deletes);
    inserts.push(...p.inserts);
  };
  for (const c of list) {
    const f = def.fields.find((x) => x.key === c.key)!;
    if (f.kind === "place") {
      add(moveParts(read.subject, nodesOf(read).old, checked(edit.place!)));
    } else if (f.kind === "contacts") {
      const { gone, added } = handleChanges(def.contactTypes, profile.contacts!, edit.handles ?? []);
      add(handleParts(read, def.contactTypes, gone, added));
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

/** The profile as the pod holds it now (the tool's first read). Throws a PublishError like any read of the file. */
export async function loadProfile(fileUrl: string, def: ProfileDef, fetchImpl: Fetch = (u, i) => authFetch(u, i)): Promise<{ profile: Profile; etag: string | null; text: string }> {
  const read = await readSpaceFile(fileUrl, fetchImpl);
  return { profile: readProfile(read, def), etag: read.etag, text: read.text };
}

export interface SaveResult {
  /** saved: written and read back. same: the file already says all of it; nothing was written. */
  status: "saved" | "same";
  changes: Change[];
  /** The file as the pod holds it after the save (or as read, when nothing was written). */
  text: string;
  profile: Profile;
  /** The file's ETag now: the next save's baseline. */
  etag: string | null;
}

/**
 * The profile saved: the changed fields written to the space file at `fileUrl` in one patch, with the ETag of
 * the read. Throws a PublishError: incomplete, expired, no-control, gone, conflict, unreachable, refused,
 * unreadable, unconfirmed. `edit` holds what the person changed; its address was geocoded by the caller.
 */
export async function saveProfile(fileUrl: string, def: ProfileDef, edit: Edit, fetchImpl: Fetch = (u, i) => authFetch(u, i)): Promise<SaveResult> {
  const typed = edit.values ?? {};
  for (const f of def.fields) {
    if (f.required && f.property && f.key in typed && !typed[f.key].trim()) throw new PublishError("incomplete", `${f.label} can't be empty.`);
  }
  const before = await readSpaceFile(fileUrl, fetchImpl);
  const profile = readProfile(before, def);
  // The screen showed an older file: what it holds may not be what is there now. Nothing is written over it.
  if (edit.baseEtag !== undefined && before.etag !== edit.baseEtag) throw new PublishError("conflict", "The file changed since this screen read it.");
  const list = changes(def, profile, edit);
  if (!list.length) return { status: "same", changes: [], text: before.text, profile, etag: before.etag };
  // Without the read's ETag the write can't be conditional: it would land over a change it never saw.
  if (!before.etag) throw new PublishError("refused", "The pod sent no ETag, so the write can't check the file is unchanged.");

  const body = profilePatch(before, def, profile, list, edit);
  const res = await send(fetchImpl, fileUrl, { method: "PATCH", headers: { "Content-Type": "text/n3", "If-Match": before.etag }, body });
  if (!res.ok) fail(res, "Saving the profile");

  // The write is in: from here a failure is "not confirmed", never "nothing was written".
  let after: SpaceRead;
  let now: Profile;
  try {
    after = await readSpaceFile(fileUrl, fetchImpl);
    now = readProfile(after, def);
  } catch (err) {
    throw new PublishError("unconfirmed", `Saved, but reading it back failed: ${(err as Error).message}`);
  }
  // Another writer may have changed it again since: what matters is that ours went in.
  const asked = new Set(list.map((c) => c.key));
  const missing = changes(def, now, {
    values: Object.fromEntries(Object.entries(typed).filter(([k]) => asked.has(k))),
    place: asked.has("address") ? edit.place : undefined,
    handles: asked.has("contacts") ? edit.handles : undefined,
  });
  if (missing.length) throw new PublishError("unconfirmed", "Saved, but the file read back doesn't say it: it may have changed since.");
  return { status: "saved", changes: list, text: after.text, profile: now, etag: after.etag };
}
