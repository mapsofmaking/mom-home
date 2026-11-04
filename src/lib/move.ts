/**
 * Tile C, a space that moves (Story 14.6 S5, AC1b, #40): the street address and the pin, changed together.
 *
 * The new address is placed by the geocoder first (workbench/where.ts `findPlace`, tile A's route); what it
 * found arrives here as a `Place`. Then one N3 Patch changes the address and the coordinates in the space's
 * file, so the two move together or not at all: the address node and the geo node are named by variables
 * (`?a`, `?g`; they are blank nodes, which a patch can't name), bound by `solid:where` to the values just
 * read, sent with that read's ETag (`If-Match`). A file changed since is refused (412), or no longer matches
 * (409): nothing is written either way.
 *
 * Only the values the move changes are touched: street, postcode, town and country on the address node,
 * latitude and longitude on the geo node. Anything else on those nodes (a region another app added) and
 * the nodes themselves stay. A file with no address or geo node, or with two, is left alone: which one to
 * change is not this page's guess.
 *
 * Written, the file is read back: the new street and coordinates must be there.
 */
import type { Quad, Term } from "n3";
import { authFetch } from "./auth";
import { fail, iri, n3Term, readSpaceFile, type SpaceRead } from "./hours";
import { PublishError, send } from "./publish";
import { literal } from "./spacefile";

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

const SCHEMA = "https://schema.org/";
const ADDRESS = SCHEMA + "address";
const GEO = SCHEMA + "geo";
const STREET = SCHEMA + "streetAddress";
const POSTCODE = SCHEMA + "postalCode";
const TOWN = SCHEMA + "addressLocality";
const COUNTRY = SCHEMA + "addressCountry";
const LAT = SCHEMA + "latitude";
const LON = SCHEMA + "longitude";

/** Where the space is: what the file says, or what the geocoder found for the new address. */
export interface Place {
  street: string;
  postcode: string;
  city: string;
  /** Two letters, upper case. */
  country: string;
  lat: number;
  lon: number;
}

export interface MoveResult {
  /** saved: written and read back. same: the file already says exactly this; nothing was written. */
  status: "saved" | "same";
  /** What the file said before. */
  was: Place;
  now: Place;
  /** The file as the pod holds it after the move, read back (or as read, when nothing was written). */
  text: string;
}

/** A coordinate as Turtle writes a decimal: seven places (about 1 cm), no trailing zeros, always a point. */
export function decimal(n: number): string {
  if (!Number.isFinite(n)) throw new PublishError("incomplete", "No coordinates to write.");
  return n.toFixed(7).replace(/0+$/, "").replace(/\.$/, ".0");
}

interface Nodes {
  address: Term;
  geo: Term;
  /** The statements on each node the move changes, as read. */
  old: { address: Quad[]; geo: Quad[] };
  was: Place;
}

const one = (quads: Quad[], p: string) => quads.find((q) => q.predicate.value === p)?.object.value ?? "";

/** The space's one address node and one geo node, and what they say. Refused when either is missing or doubled. */
function nodesOf(read: SpaceRead): Nodes {
  const on = (s: Term, p: string) => read.quads.filter((q) => q.subject.equals(s) && q.predicate.value === p);
  const linked = (p: string, what: string): Term => {
    const objects = read.quads.filter((q) => q.subject.value === read.subject && q.predicate.value === p).map((q) => q.object);
    if (objects.length !== 1) throw new PublishError("unreadable", `The space file has ${objects.length || "no"} ${what}; this page changes one: left alone.`);
    const node = objects[0];
    if (node.termType !== "BlankNode" && node.termType !== "NamedNode") throw new PublishError("unreadable", `The space file's ${what} is a line of text, not a node: left alone.`);
    return node;
  };
  const address = linked(ADDRESS, "address");
  const geo = linked(GEO, "coordinates");
  const old = {
    address: [STREET, POSTCODE, TOWN, COUNTRY].flatMap((p) => on(address, p)),
    geo: [LAT, LON].flatMap((p) => on(geo, p)),
  };
  const was: Place = {
    street: one(old.address, STREET),
    postcode: one(old.address, POSTCODE),
    city: one(old.address, TOWN),
    country: one(old.address, COUNTRY).toUpperCase(),
    lat: Number(one(old.geo, LAT)),
    lon: Number(one(old.geo, LON)),
  };
  return { address, geo, old, was };
}

/** The move as one N3 Patch: the values read go, the new ones come, on the same two nodes. */
export function movePatch(subject: string, old: Nodes["old"], next: Place): string {
  const s = iri(subject);
  const line = (node: string, q: Quad) => `${node} ${iri(q.predicate.value)} ${n3Term(q.object)} .`;
  const was = [...old.address.map((q) => line("?a", q)), ...old.geo.map((q) => line("?g", q))];
  const now = [
    ...(next.street ? [`?a ${iri(STREET)} ${literal(next.street)} .`] : []),
    ...(next.postcode ? [`?a ${iri(POSTCODE)} ${literal(next.postcode)} .`] : []),
    `?a ${iri(TOWN)} ${literal(next.city)} .`,
    `?a ${iri(COUNTRY)} ${literal(next.country)} .`,
    `?g ${iri(LAT)} ${decimal(next.lat)} .`,
    `?g ${iri(LON)} ${decimal(next.lon)} .`,
  ];
  return [
    "@prefix solid: <http://www.w3.org/ns/solid/terms#> .",
    "_:move a solid:InsertDeletePatch ;",
    `  solid:where { ${s} ${iri(ADDRESS)} ?a . ${s} ${iri(GEO)} ?g . ${was.join(" ")} } ;`,
    ...(was.length ? [`  solid:deletes { ${was.join(" ")} } ;`] : []),
    `  solid:inserts { ${now.join(" ")} } .`,
    "",
  ].join("\n");
}

const samePlace = (a: Place, b: Place) =>
  a.street === b.street && a.postcode === b.postcode && a.city === b.city && a.country === b.country && a.lat === b.lat && a.lon === b.lon;

/** The new place, checked: a town, a two-letter country, coordinates on the globe. */
function checked(next: Place): Place {
  const place = {
    street: next.street.trim(), postcode: next.postcode.trim(), city: next.city.trim(), country: next.country.trim().toUpperCase(),
    lat: Number(decimal(next.lat)), lon: Number(decimal(next.lon)),
  };
  if (!place.city || !/^[A-Z]{2}$/.test(place.country) || Math.abs(place.lat) > 90 || Math.abs(place.lon) > 180) {
    throw new PublishError("incomplete", "The place found has no town, country or coordinates to write.");
  }
  return place;
}

/**
 * The space moved: its address and pin, changed in the file at `fileUrl` in one write. Throws a PublishError:
 * incomplete, expired, no-control, gone, conflict, unreachable, refused, unreadable, unconfirmed.
 */
export async function moveSpace(fileUrl: string, next: Place, fetchImpl: Fetch = (u, i) => authFetch(u, i)): Promise<MoveResult> {
  const now = checked(next);
  const before = await readSpaceFile(fileUrl, fetchImpl);
  const nodes = nodesOf(before);
  if (samePlace(nodes.was, now)) return { status: "same", was: nodes.was, now, text: before.text };
  if (!before.etag) throw new PublishError("refused", "The pod sent no ETag, so the write can't check the file is unchanged.");

  const body = movePatch(before.subject, nodes.old, now);
  const res = await send(fetchImpl, fileUrl, { method: "PATCH", headers: { "Content-Type": "text/n3", "If-Match": before.etag }, body });
  if (!res.ok) fail(res, "Moving the space");

  // The write is in: from here a failure is "not confirmed", never "nothing was written".
  let after: Nodes;
  let text: string;
  try {
    const read = await readSpaceFile(fileUrl, fetchImpl);
    after = nodesOf(read);
    text = read.text;
  } catch (err) {
    throw new PublishError("unconfirmed", `Written, but reading it back failed: ${(err as Error).message}`);
  }
  // Another writer may have changed it again since: what matters is that ours went in.
  if (after.was.street !== now.street || after.was.lat !== now.lat || after.was.lon !== now.lon) {
    throw new PublishError("unconfirmed", "Written, but the file read back doesn't say it: it may have changed since.");
  }
  return { status: "saved", was: nodes.was, now, text };
}
