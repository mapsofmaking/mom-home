/**
 * The space's contact handles (Story 14.6 S4, #39): one or many, of the kinds the tree lists (`onb:ContactType`:
 * Matrix, Telegram, phone, ...). Each kind lives in one place in the file: a statement of its own on the space
 * (`schema:email`, `schema:telephone`), or a `schema:contactPoint` with its `schema:contactType` and a
 * `schema:url`. The map's card shows each handle with its picto.
 *
 * A contact point this page doesn't fully understand (a type the tree doesn't list, a statement besides its type
 * and its link, two links) is listed as it is and never touched: another writer put it there.
 *
 * Changing the handles touches only those added or taken away; the others stay as they are in the file.
 */
import type { Quad, Term } from "n3";
import type { ContactType } from "../tree/parse";
import { normalizeMatrix, normalizeUrl } from "../workbench/describe";
import { iri as strictIri, n3Term, type SpaceRead } from "./hours";
import { PublishError } from "./publish";
import { iri, literal, matrixLink } from "./spacefile";
import type { Issue } from "./profile";

const SCHEMA = "https://schema.org/";
const CONTACT = SCHEMA + "contactPoint";
const CONTACT_TYPE = SCHEMA + "contactType";
const CONTACT_URL = SCHEMA + "url";
const CONTACT_CLASS = SCHEMA + "ContactPoint";
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";

/** A handle as the person reads and types it: a room, an @name, an address, a number, a link. */
export interface Handle {
  type: string;
  value: string;
}

/** A handle as the file holds it, with the statements that make it. */
export interface FileHandle extends Handle {
  /** The contact point's node; null for a statement of its own (email, phone). */
  node: Term | null;
  quads: Quad[];
  /** Its value is held as text where an address belongs, or the like: saving it again mends it. */
  literal: boolean;
}

export interface Contacts {
  handles: FileHandle[];
  /** Contact points this page leaves alone, as "type: link" lines. */
  others: string[];
}

/** The matrix.to link back to the room as typed. */
function roomOf(link: string): string {
  const room = /^https:\/\/matrix\.to\/#\/(.+)$/.exec(link)?.[1];
  if (!room) return link;
  try {
    return decodeURIComponent(room);
  } catch {
    return link;
  }
}

/** What a link reads as for its kind: the room, the @name, the address without mailto:, the number without tel:. */
function shown(type: ContactType, value: string): string {
  switch (type.shape) {
    case "matrix":
      return roomOf(value);
    case "at":
      return type.linkPrefix && value.startsWith(type.linkPrefix) && /^[A-Za-z0-9_]+$/.test(value.slice(type.linkPrefix.length))
        ? `@${value.slice(type.linkPrefix.length)}`
        : value;
    case "email":
      return value.replace(/^mailto:/i, "");
    case "phone":
      return value.replace(/^tel:/i, "");
    case "url":
      return value;
  }
}

export function readContacts(read: SpaceRead, types: readonly ContactType[]): Contacts {
  const handles: FileHandle[] = [];
  const others: string[] = [];
  const on = (s: Term, p?: string) => read.quads.filter((q) => q.subject.equals(s) && (!p || q.predicate.value === p));
  const space = read.quads.find((q) => q.subject.value === read.subject)?.subject;
  if (!space) return { handles, others };
  for (const t of types) {
    if (!t.property) continue;
    for (const q of on(space, t.property)) handles.push({ type: t.key, value: shown(t, q.object.value), node: null, quads: [q], literal: false });
  }
  for (const link of on(space, CONTACT)) {
    const node = link.object;
    if (node.termType === "Literal") {
      others.push(node.value);
      continue;
    }
    const all = on(node);
    const kind = all.filter((q) => q.predicate.value === CONTACT_TYPE).map((q) => q.object.value);
    const urls = all.filter((q) => q.predicate.value === CONTACT_URL);
    const t = types.find((x) => x.contactType && kind.length === 1 && x.contactType.toLowerCase() === kind[0].toLowerCase());
    const plain = all.every(
      (q) => q.predicate.value === CONTACT_TYPE || q.predicate.value === CONTACT_URL || (q.predicate.value === RDF_TYPE && q.object.value === CONTACT_CLASS)
    );
    if (!t || !plain || urls.length !== 1) {
      others.push(`${kind.join(", ") || "?"}: ${urls.map((q) => q.object.value).join(", ") || "—"}`);
      continue;
    }
    handles.push({ type: t.key, value: shown(t, urls[0].object.value), node, quads: [link, ...all], literal: urls[0].object.termType === "Literal" });
  }
  return { handles, others };
}

const URLISH = /^[^\s/@]+\.[^\s/@]+/;

/** Checks a handle as the file holds it or as typed: nothing; a mend that loses nothing; or a value that needs a guess. */
export function checkHandle(type: ContactType, text: string): Issue | null {
  const t = text.trim();
  if (!t) return { type: "problem", why: "empty" };
  const spaced: Issue | null = t !== text ? { type: "fix", why: "spaces", fixed: t } : null;
  switch (type.shape) {
    case "email": {
      const bare = t.replace(/^mailto:/i, "");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(bare)) return { type: "problem", why: "email" };
      return bare !== t ? { type: "fix", why: "prefix", fixed: bare } : spaced;
    }
    case "phone": {
      const bare = t.replace(/^tel:/i, "");
      // An international number: without its country code, which country is a guess.
      if (!/^\+[0-9][0-9 ().-]{5,}$/.test(bare)) return { type: "problem", why: "phone" };
      return bare !== t ? { type: "fix", why: "prefix", fixed: bare } : spaced;
    }
    case "matrix": {
      if (matrixLink(t)) return spaced;
      const fixed = normalizeMatrix(t);
      return fixed !== t && matrixLink(fixed) ? { type: "fix", why: "room", fixed } : { type: "problem", why: "room" };
    }
    case "at": {
      if (/^@[A-Za-z0-9_]{3,}$/.test(t) || (type.linkPrefix && t.startsWith(type.linkPrefix) && iri(t))) return spaced;
      if (/^[A-Za-z0-9_]{3,}$/.test(t)) return { type: "fix", why: "handle", fixed: `@${t}` };
      return { type: "problem", why: "handle" };
    }
    case "url": {
      if (/^https?:\/\//i.test(t)) return iri(t) ? spaced : { type: "problem", why: "address" };
      const fixed = normalizeUrl(t);
      return fixed !== t && URLISH.test(t) && iri(fixed) ? { type: "fix", why: "scheme", fixed } : { type: "problem", why: "address" };
    }
  }
}

/** The handle's object in the file, as N3: a literal for email and phone, a link for the rest. null: not one this file will carry. */
export function objectOf(type: ContactType, value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  switch (type.shape) {
    case "email":
      return checkHandle(type, v)?.type === "problem" ? null : literal(v.replace(/^mailto:/i, ""));
    case "phone":
      return checkHandle(type, v)?.type === "problem" ? null : literal(v.replace(/^tel:/i, ""));
    case "matrix":
      return matrixLink(v);
    case "at":
      if (/^@[A-Za-z0-9_]{3,}$/.test(v)) return iri(`${type.linkPrefix}${v.slice(1)}`);
      return type.linkPrefix && v.startsWith(type.linkPrefix) ? iri(v) : null;
    case "url":
      return iri(v);
  }
}

const typeOf = (types: readonly ContactType[], key: string): ContactType => {
  const t = types.find((x) => x.key === key);
  if (!t) throw new PublishError("incomplete", `"${key}" isn't a kind of contact this page knows.`);
  return t;
};

/** A handle's identity: its kind and what the file would hold. Two handles that would write the same are one. */
function keyOf(types: readonly ContactType[], h: Handle | FileHandle): string {
  if ("quads" in h && h.literal) return `${h.type}\u0000text:${h.value}`; // held as text: never the same as what a save writes
  const t = typeOf(types, h.type);
  const object = objectOf(t, h.value);
  if (object === null) throw new PublishError("incomplete", `That isn't a ${t.label} handle this file can carry.`);
  return `${h.type}\u0000${object}`;
}

/** The handles to take away and to add, so the file says `typed`. Unchanged ones are left as they are. */
export function handleChanges(types: readonly ContactType[], file: Contacts, typed: readonly Handle[]): { gone: FileHandle[]; added: Handle[] } {
  const want = new Map<string, Handle>();
  for (const h of typed) {
    if (!h.value.trim()) continue;
    want.set(keyOf(types, h), { type: h.type, value: h.value.trim() });
  }
  const have = new Map(file.handles.map((h) => [keyOf(types, h), h] as const));
  return {
    gone: file.handles.filter((h) => !want.has(keyOf(types, h))),
    added: [...want].filter(([k]) => !have.has(k)).map(([, h]) => h),
  };
}

/** True when the file holds exactly these handles (read back after a save). */
export const sameHandles = (types: readonly ContactType[], file: Contacts, typed: readonly Handle[]) => {
  const { gone, added } = handleChanges(types, file, typed);
  return !gone.length && !added.length;
};

/** The patch parts for these changes. A contact point that is a blank node is named by a variable bound to what was read. */
export function handleParts(read: SpaceRead, types: readonly ContactType[], gone: readonly FileHandle[], added: readonly Handle[]) {
  const where: string[] = [];
  const deletes: string[] = [];
  const inserts: string[] = [];
  const s = strictIri(read.subject);
  gone.forEach((h, i) => {
    const node = h.node && h.node.termType === "BlankNode" ? `?h${i}` : h.node ? n3Term(h.node) : null;
    const term = (t: Term) => (h.node && node && t.equals(h.node) ? node : n3Term(t));
    const lines = h.quads.map((q) => `${q.subject.value === read.subject ? s : term(q.subject)} ${strictIri(q.predicate.value)} ${term(q.object)} .`);
    if (node?.startsWith("?")) where.push(...lines);
    deletes.push(...lines);
  });
  const base = read.subject.split("#")[0];
  const taken = new Set(read.quads.map((q) => q.subject.value));
  for (const h of added) {
    const t = typeOf(types, h.type);
    const object = objectOf(t, h.value)!;
    if (t.property) {
      inserts.push(`${s} ${strictIri(t.property)} ${object} .`);
      continue;
    }
    // A named node, so the patch needs no blank node; a name not in the file yet.
    let n = 1;
    while (taken.has(`${base}#contact-${t.key}-${n}`)) n++;
    const name = `${base}#contact-${t.key}-${n}`;
    taken.add(name);
    const node = strictIri(name);
    inserts.push(
      `${s} ${strictIri(CONTACT)} ${node} .`,
      `${node} ${strictIri(RDF_TYPE)} ${strictIri(CONTACT_CLASS)} ; ${strictIri(CONTACT_TYPE)} ${literal(t.contactType!)} ; ${strictIri(CONTACT_URL)} ${object} .`
    );
  }
  return { where, deletes, inserts };
}
