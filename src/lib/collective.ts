/**
 * A network becomes a Solid collective (#69, slice 1 of the networks epic): an inbox where requests to join
 * arrive, `config.ttl` that the backoffice reads (public), and the roster (only the owner reads it). Accepting
 * and refusing stay in the backoffice; home sets the collective up and shows the invitation link.
 *
 * Copied, not packaged (kit ADR 004), from solid-backoffice @ ea20fad:
 * - `src/lib/collective.ts`: `parseCollectiveConfig` with `explainParseError`, `KNOWN_PREFIXES`, `isFolderPath`
 *   and the `Collective` types, unchanged (the old `hs:` namespace is still read, as there);
 * - `src/lib/newcomer.ts` `createInbox`: the inbox, then Authenticated Append, before anything names it;
 * - `src/invite.ts` `appLink`: the invitation's encoding (":" and "/" kept, the rest encoded);
 * - `templates/collective/config.ttl` and `membres.ttl`: the files' shapes.
 * A fix to the copied parts lands in the backoffice first.
 *
 * Rules this file keeps, each tested in collective.test.ts:
 *
 * 1. **Done is read from the pod, never stored**, and only on proof: `config.ttl` at the pod root parses, and
 *    the roster and the inbox IT NAMES exist. `sc:roster` is followed, never assumed: Maakbib's hand-made file
 *    names `members.ttl`, and reads done with nothing written.
 * 2. **Only a 404 is "missing".** A 401 or 403 says nothing about existence (CLAUDE.md, Auth errors): it is
 *    `expired`, and nothing is written on it. A "missing" read wrongly would start writes.
 * 3. **Nothing is overwritten.** Every new file is a PUT with `If-None-Match: *`; a 412 means "it is there:
 *    keep it". A `config.ttl` that is there and doesn't parse stops everything, and says why.
 * 4. **The targets come from what is there.** When `config.ttl` exists, its own roster and inbox are the ones
 *    made (if missing), never the defaults; and only inside this pod: a config naming another server is refused,
 *    so the session's token never goes there.
 * 5. **Nothing is advertised before it exists** (createInbox's order): the inbox and the roster first,
 *    `config.ttl` after them, then its public Read, then the link from `space.ttl`. A run that stops halfway
 *    never leaves a public config pointing at a 404, and the next run carries on from what is there.
 * 6. **`space.ttl` gains one statement**, `rdfs:seeAlso <config.ttl#slug>` (never `owl:sameAs`, which would merge
 *    the two descriptions), in one insert-only N3 Patch with the read's ETag; skipped when it is already there.
 * 7. **No `/profile/` write** (2026-11-20): joins go to the inbox `config.ttl` names.
 *
 * ACLs go through acl.ts (hand-written Turtle, kit ADR 003): the inbox's is `setAuthenticatedAccess` as
 * createInbox does it, the roster's "only me" is `setAccess` with nobody else, created only if it has none,
 * and `config.ttl`'s public Read is publish.ts `makePublic`, with its stranger's read as proof.
 */
import { Parser, type Quad } from "n3";
import { BACKOFFICE_URL } from "../config";
import { getAccess, setAccess, setAuthenticatedAccess, type Mode } from "./acl";
import { authFetch } from "./auth";
import { fail, iri as strictIri, readSpaceFile } from "./hours";
import { slugify } from "./pod";
import { aclFailure, makePublic, PublishError, send } from "./publish";
import { literal } from "./spacefile";

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;
const signedIn: Fetch = (url, init) => authFetch(url, init);

/* ── Copied from solid-backoffice @ ea20fad src/lib/vocab.ts (the terms this file reads) ──────────────── */

export const NS = {
  foaf: "http://xmlns.com/foaf/0.1/",
  org: "http://www.w3.org/ns/org#",
  ldp: "http://www.w3.org/ns/ldp#",
  rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
  schema: "http://schema.org/",
  sc: "https://w3id.org/solid-collective/vocab#",
  hsLegacy: "https://pod.nicolasdb.eu/hyperscope/vocab#",
} as const;

const FOAF_NAME = NS.foaf + "name";
const INBOX = NS.ldp + "inbox";
const RDFS_SEE_ALSO = "http://www.w3.org/2000/01/rdf-schema#seeAlso";

/* ── Copied from solid-backoffice @ ea20fad src/lib/collective.ts ────────────────────────────────────── */

interface CollectiveBase {
  configUrl: string;
  /** The IRI members point at with `org:memberOf`, and the roster lists under. */
  group: string;
  name: string;
  /** The document listing `<group> foaf:member <WebID>`. Readable by members only. */
  roster: string;
  /** Where `as:Join` and `as:Announce` go. Signed-in agents may Append. */
  inbox: string;
  suggestedFolder?: string;
  /** The welcome screen's title for people it invites (`schema:slogan`), when it has exactly one. */
  slogan?: string;
  /** The paragraph under it (`schema:description`), when it has exactly one. */
  description?: string;
}

export type Collective = CollectiveBase &
  (
    | { sharing: true; agent: string }
    | { sharing: false; agent?: string }
  );

function parse(turtle: string, base: string): Quad[] {
  return new Parser({ baseIRI: base }).parse(turtle);
}

function objectsOf(quads: Quad[], subject: string, predicate: string): string[] {
  return quads
    .filter((q) => q.subject.value === subject && q.predicate.value === predicate)
    .map((q) => q.object.value);
}

/** The prefix line a config.ttl needs for each namespace it may use. */
const KNOWN_PREFIXES: Record<string, string> = {
  sc: NS.sc,
  hs: NS.hsLegacy,
  foaf: NS.foaf,
  ldp: NS.ldp,
  schema: NS.schema,
  org: NS.org,
  rdf: NS.rdf,
};

/**
 * Parse errors say what the parser saw; for a missing prefix, also say the
 * line that fixes it (typically `schema:` added for the welcome words).
 */
function explainParseError(err: unknown, configUrl: string): Error {
  const message = err instanceof Error ? err.message : String(err);
  const prefix = /Undefined prefix "(\w+):"/.exec(message)?.[1];
  const fix = prefix && KNOWN_PREFIXES[prefix]
    ? ` Add this line at the top of the file: @prefix ${prefix}: <${KNOWN_PREFIXES[prefix]}> .`
    : "";
  return new Error(`${configUrl} is not valid Turtle: ${message}.${fix}`);
}

/**
 * Parses a collective's `config.ttl`. Throws, naming what is wrong, rather
 * than filling a default: a guessed agent WebID is a grant to the wrong party.
 *
 * Both namespaces are read (solid-kit ADR 006 §7): `sc:` and the old `hs:`.
 * A collective typed only `hs:Collective` is read exactly as before: its
 * agent and its folder are required, and sharing is on. One typed
 * `sc:Collective` shares only with `sc:feature sc:Sharing`. A term given in
 * both namespaces (`sc:agent` and `hs:agent`) is refused, not merged: which
 * one is meant cannot be told, and for the agent a guess is a grant.
 */
export function parseCollectiveConfig(turtle: string, configUrl: string, expected?: string): Collective {
  let quads: Quad[];
  try {
    quads = parse(turtle, configUrl);
  } catch (err) {
    throw explainParseError(err, configUrl);
  }
  const typed = (type: string) =>
    quads.filter((q) => q.predicate.value === NS.rdf + "type" && q.object.value === type).map((q) => q.subject.value);
  const declared = [...new Set([...typed(NS.sc + "Collective"), ...typed(NS.hsLegacy + "Collective")])];
  const subject = expected ? declared.find((d) => d === expected) : declared[0];
  if (!subject) {
    throw new Error(`${configUrl} declares no sc:Collective${expected ? ` named ${expected}` : ""}.`);
  }
  if (!expected && declared.length > 1) {
    throw new Error(`${configUrl} declares several collectives; use the address of one of them.`);
  }
  // Typed in the old namespace only: read as before §7.
  const legacy = !typed(NS.sc + "Collective").includes(subject);

  /** A term's values, from whichever namespace gives it, and its name in errors. */
  const term = (current: string, old: string): { values: string[]; label: string } => {
    const now = objectsOf(quads, subject, NS.sc + current);
    const before = objectsOf(quads, subject, NS.hsLegacy + old);
    if (now.length && before.length) {
      throw new Error(
        `${configUrl} gives both sc:${current} and hs:${old}: keep sc:${current} only. ` +
          "Which one is meant cannot be guessed (solid-kit ADR 006 §7)."
      );
    }
    return { values: now.length ? now : before, label: before.length || (legacy && !now.length) ? `hs:${old}` : `sc:${current}` };
  };
  const exactlyOne = ({ values, label }: { values: string[]; label: string }, why = ""): string => {
    if (values.length !== 1) throw new Error(`${configUrl}: ${why}expected exactly one ${label}, found ${values.length}.`);
    return values[0];
  };
  const atMostOne = ({ values, label }: { values: string[]; label: string }): string | undefined => {
    if (values.length > 1) throw new Error(`${configUrl}: expected at most one ${label}, found ${values.length}.`);
    return values[0];
  };
  const one = (predicate: string, label: string): string => exactlyOne({ values: objectsOf(quads, subject, predicate), label });

  // `sc:feature` is new with §7: the old namespace never had one.
  const sharing = legacy || objectsOf(quads, subject, NS.sc + "feature").includes(NS.sc + "Sharing");
  const agentTerm = term("agent", "agent");
  const folderTerm = term("suggestedFolder", "bundleFolder");
  const agent = sharing
    ? exactlyOne(agentTerm, legacy ? "" : "sc:feature sc:Sharing needs an agent: ")
    : atMostOne(agentTerm);
  // The old namespace required the folder; it stays required there.
  const suggestedFolder = legacy ? exactlyOne(folderTerm) : atMostOne(folderTerm);
  if (suggestedFolder !== undefined && !isFolderPath(suggestedFolder)) {
    throw new Error(`${configUrl}: ${folderTerm.label} must be a folder path like "output2/hyperscope/".`);
  }

  // Presentation only, so a repeated one is ignored rather than refused:
  // no grant depends on it (docs/reference/collective-files.md#welcome-copy).
  // schema.org is written with http:// or https://; both are read.
  const optional = (term: string): string | undefined => {
    const values = [NS.schema, "https://schema.org/"]
      .flatMap((ns) => objectsOf(quads, subject, ns + term))
      .map((v) => v.trim())
      .filter(Boolean);
    return values.length === 1 ? values[0] : undefined;
  };
  const slogan = optional("slogan");
  const description = optional("description");

  const base: CollectiveBase = {
    configUrl,
    group: subject,
    name: one(FOAF_NAME, "foaf:name"),
    roster: exactlyOne(term("roster", "roster")),
    inbox: one(INBOX, "ldp:inbox"),
    ...(suggestedFolder !== undefined ? { suggestedFolder } : {}),
    ...(slogan ? { slogan } : {}),
    ...(description ? { description } : {}),
  };
  if (sharing && agent !== undefined) return { ...base, sharing: true, agent };
  return { ...base, sharing: false, ...(agent !== undefined ? { agent } : {}) };
}

/**
 * A relative folder path inside the member's pod, such as "output2/hyperscope/":
 * plain segments, ending in "/". No "..", no ".", no absolute path — the config
 * is someone else's file, and it decides where the member's app creates a folder.
 */
function isFolderPath(value: string): boolean {
  if (!value.endsWith("/")) return false;
  const segments = value.slice(0, -1).split("/");
  return segments.every((seg) => /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/.test(seg) && seg !== "." && seg !== "..");
}

/* ── Home's own: reading it, setting it up ──────────────────────────────────────────────────────────── */

/**
 * The invitation: the backoffice, `?collective=` and the address of `config.ttl` (the document, as the
 * backoffice's `loadCollective` takes an invitation's address). Encoded as solid-backoffice @ ea20fad
 * `src/invite.ts` `appLink` does: ":" and "/" stay as they are (RFC 3986 allows them in a query), so the
 * address stays readable; what would break the link (&, #, +, ?, spaces) is encoded.
 */
export function inviteLink(configUrl: string): string {
  return `${BACKOFFICE_URL}/?collective=${encodeURIComponent(configUrl).replace(/%3A/gi, ":").replace(/%2F/gi, "/")}`;
}

/** The parts a collective needs besides `config.ttl`. */
export type Part = "roster" | "inbox";

export type CollectiveState =
  /** No `config.ttl` at the pod root (404): the network isn't a collective yet. */
  | { state: "none"; configUrl: string }
  /** `config.ttl` parses, and something it names is missing (404): a setup that stopped halfway. */
  | { state: "incomplete"; configUrl: string; collective: Collective; missing: Part[]; seeAlso?: string[] }
  /** It parses, and its roster and inbox exist: the tile is done. */
  | { state: "done"; configUrl: string; collective: Collective; link: string; seeAlso?: string[] };

const withRoot = (podRoot: string) => (podRoot.endsWith("/") ? podRoot : podRoot + "/");
export const configUrlOf = (podRoot: string) => new URL("config.ttl", withRoot(podRoot)).href;

/** Inside this pod: same origin, under its root. The session's token is never sent anywhere else. */
const inPod = (url: string, root: string) => {
  try {
    const u = new URL(url);
    const r = new URL(root);
    return u.origin === r.origin && u.pathname.startsWith(r.pathname) && !u.hash && !u.search;
  } catch {
    return false;
  }
};

/** A read's failure: 401 and 403 are the session (never "missing"), anything else is the pod saying no. */
function readFailure(res: Response, what: string): PublishError {
  if (res.status === 401 || res.status === 403) {
    return new PublishError("expired", `${what}: the pod refused this session (${res.status}).`, res.status);
  }
  return new PublishError("refused", `${what} (${res.status}).`, res.status);
}

/** Whether a resource is there: true, false on a 404 only; a 401/403 or any other refusal throws. */
async function exists(url: string, fetchImpl: Fetch): Promise<boolean> {
  const res = await send(fetchImpl, url, { method: "HEAD" });
  if (res.status === 404) return false;
  if (!res.ok) throw readFailure(res, `Could not check ${url}`);
  return true;
}

/**
 * What the pod says about the network as a collective, read now, signed in. Throws a PublishError:
 * `expired` on a 401/403 anywhere (never read as "missing"), `unreadable` when `config.ttl` is there and can't
 * be used (it doesn't parse, or names a roster or an inbox outside this pod), `unreachable`, `refused`.
 */
export async function readCollective(podRoot: string, fetchImpl: Fetch = signedIn): Promise<CollectiveState> {
  const root = withRoot(podRoot);
  const configUrl = configUrlOf(root);
  const res = await send(fetchImpl, configUrl, { headers: { Accept: "text/turtle" } });
  if (res.status === 404) return { state: "none", configUrl };
  if (!res.ok) throw readFailure(res, "Could not read config.ttl");
  let collective: Collective;
  let seeAlso: string[];
  try {
    const text = await res.text();
    collective = parseCollectiveConfig(text, configUrl);
    // Home's own, beside the copied parser: where the collective says its network's description is.
    seeAlso = objectsOf(parse(text, configUrl), collective.group, RDFS_SEE_ALSO);
  } catch (err) {
    throw new PublishError("unreadable", (err as Error).message);
  }
  for (const [part, url] of [["roster", collective.roster], ["inbox", collective.inbox]] as const) {
    if (!inPod(url, root)) throw new PublishError("unreadable", `${configUrl} names a ${part} outside this pod (${url}): left alone.`);
  }
  const [roster, inbox] = await Promise.all([exists(collective.roster, fetchImpl), exists(collective.inbox, fetchImpl)]);
  const missing: Part[] = [...(roster ? [] : ["roster" as const]), ...(inbox ? [] : ["inbox" as const])];
  if (missing.length) return { state: "incomplete", configUrl, collective, missing, seeAlso };
  return { state: "done", configUrl, collective, link: inviteLink(configUrl), seeAlso };
}

/** What the coordinator gives: the network's name (from space.ttl), and the invitation's words. */
export interface SetUpInput {
  podRoot: string;
  /** The signer, who owns the pod: the owner block of every rule written. */
  webId: string;
  /** `foaf:name`, from the network's file. */
  name: string;
  /** `schema:slogan`: the invitation's title. Empty: none. */
  slogan: string;
  /** `schema:description`: prefilled from the network's file, edited for the invitation. Empty: none. */
  description: string;
  /** The network's file, where the link back goes. */
  spaceFile: string;
}

/** For tests: the signed-in fetch for home's own requests, and the stranger's read that proves the config public. */
export interface SetUpDeps {
  fetch?: Fetch;
  anonFetch?: Fetch;
}

/** A new file: PUT with `If-None-Match: *`. "made", or "there" on a 412: something is already there, and is kept. */
async function putNew(fetchImpl: Fetch, url: string, body: string, what: string): Promise<"made" | "there"> {
  const container = url.endsWith("/");
  const res = await send(fetchImpl, url, {
    method: "PUT",
    headers: {
      "Content-Type": "text/turtle",
      "If-None-Match": "*",
      ...(container ? { Link: '<http://www.w3.org/ns/ldp#BasicContainer>; rel="type"' } : {}),
    },
    body,
  });
  if (res.status === 412) return "there";
  if (!res.ok) fail(res, what);
  return "made";
}

/**
 * The inbox (createInbox, solid-backoffice @ ea20fad newcomer.ts:18): the container, then anyone signed in may
 * Append and only the owner reads. Rules that already let anyone signed in append are left as they are.
 */
async function createInbox(inbox: string, owner: string, fetchImpl: Fetch): Promise<void> {
  await putNew(fetchImpl, inbox, "", "Creating the inbox");
  const what = "Could not set who can write to the inbox";
  let authenticated: Mode[];
  try {
    const access = await getAccess(inbox, owner);
    if (!access.inherited && access.authenticated.includes("append")) return;
    authenticated = [...new Set<Mode>([...access.authenticated, "append"])];
  } catch (err) {
    throw aclFailure(err, what, true);
  }
  try {
    await setAuthenticatedAccess(inbox, owner, authenticated);
  } catch (err) {
    throw aclFailure(err, what, false);
  }
}

/** The roster as the backoffice's template has it at creation: the prefix and the comments, no members. */
export function rosterTurtle(group: string): string {
  const g = group.replace(/[\r\n]/g, "");
  return `# The collective's side of the handshake (solid-kit ADR 006 §2): who its members are.
# Written by Maps of Making home, from solid-backoffice @ ea20fad templates/collective/membres.ttl.
#
# Descriptive only: it grants NOTHING. Rights stay in the .acl files, one WebID at a time.
# Only the owner reads it; accepting someone in the backoffice lets them read it too.
#
# Two kinds of lines, both facts the collective owns:
# - foaf:member, under the collective's IRI from config.ttl;
# - foaf:nick, the short name the collective uses for them. Set at acceptance, never changed once used.
# Names and agents are NOT copied here: they are read from each profile.
#
# Empty at creation: the backoffice adds both lines when a request is accepted, for example:
# <${g}> foaf:member <https://pod.example/alice/profile/card#me> .
# <https://pod.example/alice/profile/card#me> foaf:nick "alice" .

@prefix foaf: <http://xmlns.com/foaf/0.1/> .
`;
}

/**
 * The roster, empty, then rules of its own: only the owner. Rules are written only on a roster this run made,
 * or one a run that never finished made (no config.ttl yet), and only when it has none of its own: a roster
 * with rules of its own (members the backoffice let in) is never narrowed.
 */
async function writeRoster(roster: string, group: string, owner: string, fresh: boolean, fetchImpl: Fetch): Promise<void> {
  const made = await putNew(fetchImpl, roster, rosterTurtle(group), "Creating the roster");
  if (made === "there" && !fresh) return;
  const what = "Could not set who can read the roster";
  let inherited: boolean;
  try {
    inherited = (await getAccess(roster, owner)).inherited;
  } catch (err) {
    throw aclFailure(err, what, true);
  }
  if (!inherited) return;
  try {
    await setAccess(roster, owner, { agents: [], public: [], authenticated: [] }, null);
  } catch (err) {
    throw aclFailure(err, what, false);
  }
}

/** A path relative to the config's folder when it is inside it; the whole address otherwise. */
const near = (url: string, root: string) => (url.startsWith(root) && !url.slice(root.length).startsWith("/") ? url.slice(root.length) : url);

/** `config.ttl` as home writes it: the template's shape, https://schema.org/ (the backoffice reads both). */
export function configTurtle(c: { slug: string; name: string; slogan: string; description: string; roster: string; inbox: string; space: string; root: string }): string {
  const ref = (url: string) => strictIri(near(url, c.root));
  const lines = [
    `    foaf:name ${literal(c.name.trim())}`,
    ...(c.slogan.trim() ? [`    schema:slogan ${literal(c.slogan.trim())}`] : []),
    ...(c.description.trim() ? [`    schema:description ${literal(c.description.trim())}`] : []),
    `    sc:roster ${ref(c.roster)}`,
    `    ldp:inbox ${ref(c.inbox)}`,
    // The network's own description stays in its file; this says where it is (never owl:sameAs).
    `    rdfs:seeAlso ${ref(c.space)}`,
  ];
  return `# config.ttl: this network's entry point as a Solid collective, for the backoffice and for agents.
# Written by Maps of Making home, from solid-backoffice @ ea20fad templates/collective/config.ttl.
#
# <#${c.slug}> is the collective's IRI and its group IRI: members write org:memberOf <config.ttl#${c.slug}>.
# A collective of members only: people ask to join, you accept them in the backoffice, they read the roster.
# Nothing is shared with it. The network's own description is in the file rdfs:seeAlso names.

@prefix sc:     <https://w3id.org/solid-collective/vocab#> .
@prefix foaf:   <http://xmlns.com/foaf/0.1/> .
@prefix ldp:    <http://www.w3.org/ns/ldp#> .
@prefix schema: <https://schema.org/> .
@prefix rdfs:   <http://www.w3.org/2000/01/rdf-schema#> .

<#${c.slug}> a sc:Collective, foaf:Group ;
${lines.join(" ;\n")} .
`;
}

/**
 * `config.ttl`, written once (`If-None-Match: *`) when `body` is given, then open to anyone: the backoffice reads
 * it before sign-in. `body` null: the file is there already and is never written; a public Read it lacks is added.
 */
async function writeConfig(configUrl: string, body: string | null, owner: string, deps: Required<SetUpDeps>): Promise<void> {
  if (body !== null) await putNew(deps.fetch, configUrl, body, "Writing config.ttl");
  await makePublic(configUrl, owner, {
    accept: "text/turtle",
    anonFetch: deps.anonFetch,
    isTheResource: (text) => {
      try {
        parseCollectiveConfig(text, configUrl);
        return true;
      } catch {
        return false;
      }
    },
  });
}

/** The network's file links to its collective: one insert-only N3 Patch with the read's ETag; nothing if it already does. */
async function linkSpace(spaceFile: string, group: string, fetchImpl: Fetch): Promise<void> {
  const read = await readSpaceFile(spaceFile, fetchImpl);
  const has = (quads: readonly Quad[], subject: string) =>
    quads.some((q) => q.subject.value === subject && q.predicate.value === RDFS_SEE_ALSO && q.object.value === group);
  if (has(read.quads, read.subject)) return;
  if (!read.etag) throw new PublishError("refused", "The pod sent no ETag, so the write can't check the file is unchanged.");
  const body = [
    "@prefix solid: <http://www.w3.org/ns/solid/terms#> .",
    "_:link a solid:InsertDeletePatch ;",
    `  solid:inserts { ${strictIri(read.subject)} ${strictIri(RDFS_SEE_ALSO)} ${strictIri(group)} . } .`,
    "",
  ].join("\n");
  const res = await send(fetchImpl, spaceFile, { method: "PATCH", headers: { "Content-Type": "text/n3", "If-Match": read.etag }, body });
  if (!res.ok) fail(res, "Linking the network's file to its collective");
  let after;
  try {
    after = await readSpaceFile(spaceFile, fetchImpl);
  } catch (err) {
    throw new PublishError("unconfirmed", `Linked, but reading the file back failed: ${(err as Error).message}`);
  }
  if (!has(after.quads, after.subject)) throw new PublishError("unconfirmed", "Linked, but the file read back doesn't say it.");
}

/**
 * Sets the network up as a collective, each step skipped when it is done: the inbox with its rules, the roster
 * with its own, `config.ttl` and its public Read, then the link from the network's file. Read first: done is
 * returned as it is, with nothing written; a `config.ttl` there names the roster and the inbox to make. Read
 * last: what it returns is what the pod says. Throws a PublishError (expired, no-control, conflict, gone,
 * unreadable, rules-unknown, rules-wider, not-public, unreachable, refused, unconfirmed, incomplete).
 */
export async function setUpCollective(input: SetUpInput, deps: SetUpDeps = {}): Promise<CollectiveState> {
  const d: Required<SetUpDeps> = { fetch: deps.fetch ?? signedIn, anonFetch: deps.anonFetch ?? ((u, i) => fetch(u, i)) };
  const root = withRoot(input.podRoot);
  const before = await readCollective(root, d.fetch);
  if (before.state === "done") {
    // Done, and a run whose last step (the link back from space.ttl) failed is finished here. Only for a config that
    // links to a description in this pod: Maakbib's hand-made one links to none, and nothing more is even read.
    const ours = (before.seeAlso ?? []).filter((url) => inPod(url.split("#")[0], root));
    if (!ours.length) return before;
    const space = await readSpaceFile(input.spaceFile, d.fetch);
    if (ours.includes(space.subject)) await linkSpace(input.spaceFile, before.collective.group, d.fetch);
    return before;
  }
  const fresh = before.state === "none";
  const name = input.name.trim();
  if (fresh && !name) throw new PublishError("incomplete", "The network's file has no name to give the collective.");

  // The network's file first, read only: where config.ttl's link goes, and a file that can be patched later.
  const space = (await readSpaceFile(input.spaceFile, d.fetch)).subject;
  const slug = fresh ? slugify(name, "network") : "";
  const group = fresh ? `${before.configUrl}#${slug}` : before.collective.group;
  const roster = fresh ? new URL("membres.ttl", root).href : before.collective.roster;
  const inbox = fresh ? new URL("inbox/", root).href : before.collective.inbox;
  const missing: readonly Part[] = fresh ? ["inbox", "roster"] : before.missing;

  // A config made by hand could name an inbox that isn't a folder: never made as a file.
  if (missing.includes("inbox") && !inbox.endsWith("/")) throw new PublishError("unreadable", `${before.configUrl} names an inbox that isn't a folder (${inbox}): left alone.`);
  if (missing.includes("inbox")) await createInbox(inbox, input.webId, d.fetch);
  if (missing.includes("roster")) await writeRoster(roster, group, input.webId, fresh, d.fetch);
  // A config.ttl already there was read above and is never written; a public Read it lacks is added.
  const body = fresh ? configTurtle({ slug, name, slogan: input.slogan, description: input.description, roster, inbox, space, root }) : null;
  await writeConfig(before.configUrl, body, input.webId, d);

  // What the pod holds now: a config written meanwhile by someone else is the one linked to.
  const after = await readCollective(root, d.fetch);
  if (after.state !== "done") throw new PublishError("unconfirmed", "Set up, but reading it back doesn't show a whole collective.");
  await linkSpace(input.spaceFile, after.collective.group, d.fetch);
  return after;
}
