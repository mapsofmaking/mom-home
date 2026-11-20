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
 * 1. **Done is read from the pod, never stored**, and only on proof: `config.ttl` at the pod root parses, the
 *    roster and the inbox IT NAMES exist, and a stranger can read `config.ttl` (an invitation opens before sign-in). `sc:roster` is followed, never assumed: Maakbib's hand-made file
 *    names `members.ttl`, and reads done with nothing written.
 * 2. **Only a 404 is "missing".** A 401 (`expired`) or 403 (`no-control`) says nothing about existence
 *    (CLAUDE.md, Auth errors), and nothing is written on it. A "missing" read wrongly would start writes.
 * 3. **Nothing is overwritten.** Every new file is a PUT with `If-None-Match: *`; a 412 means "it is there:
 *    keep it". A `config.ttl` that is there and doesn't parse stops everything, and says why.
 * 4. **Home finishes only what it wrote.** A `config.ttl` is home's when its `rdfs:seeAlso` names this pod's
 *    `space.ttl`; then its own roster and inbox are the ones made (if missing), never the defaults. One home didn't
 *    write is never made public, finished or linked to: what it lacks is said. Only inside this pod: a config
 *    naming another server is refused, so the session's token never goes there.
 * 5. **Nothing is advertised before it exists** (createInbox's order): the inbox and the roster first,
 *    `config.ttl` after them, then its public Read, then the link from `space.ttl`. A run that stops halfway
 *    never leaves a public config pointing at a 404, and the next run carries on from what is there.
 * 6. **`space.ttl` gains one statement**, `rdfs:seeAlso <config.ttl#slug>` (never `owl:sameAs`, which would merge
 *    the two descriptions), in one insert-only N3 Patch with the read's ETag; skipped when it is already there.
 * 7. **No `/profile/` write** (2026-11-20): joins go to the inbox `config.ttl` names.
 *
 * ACLs go through acl.ts (hand-written Turtle, kit ADR 003), never silently narrowing or widening: a new `.acl`
 * on the inbox or the roster keeps the named agents the folder passed on (and refuses rules it can't read
 * there); the inbox adds Authenticated Append, the roster nothing more; `config.ttl`'s public Read is
 * publish.ts `makePublic`, with its stranger's read as proof.
 */
import { Parser, type Quad } from "n3";
import { BACKOFFICE_URL } from "../config";
import { getAccess, setAccess, setAuthenticatedAccess, type AgentGrant, type Mode } from "./acl";
import { authFetch } from "./auth";
import { fail, iri as strictIri, readSpaceFile } from "./hours";
import { slugify } from "./pod";
import { aclFailure, makePublic, PublishError, send, spaceFileUrl } from "./publish";
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

/** What a collective needs besides `config.ttl` parsing: its roster, its inbox, and `config.ttl` readable by anyone. */
export type Part = "roster" | "inbox" | "public";

export type CollectiveState =
  /** No `config.ttl` at the pod root (404): the network isn't a collective yet. */
  | { state: "none"; configUrl: string }
  /** Home's own `config.ttl` (it links back to this pod's space.ttl), something missing: a setup that stopped halfway. */
  | { state: "incomplete"; configUrl: string; collective: Collective; missing: Part[]; seeAlso?: string[] }
  /** A `config.ttl` home didn't write, something missing: said, never finished from here (it isn't home's to take over). */
  | { state: "foreign"; configUrl: string; collective: Collective; missing: Part[]; seeAlso?: string[] }
  /** It parses, its roster and inbox exist, and a stranger can read it: the tile is done. */
  | { state: "done"; configUrl: string; collective: Collective; link: string; seeAlso?: string[]; ours?: boolean };

const withRoot = (podRoot: string) => (podRoot.endsWith("/") ? podRoot : podRoot + "/");
export const configUrlOf = (podRoot: string) => new URL("config.ttl", withRoot(podRoot)).href;
const stranger: Fetch = (u, i) => fetch(u, i);

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

/**
 * A read's failure: 401 is the session (never "missing"); 403 is this account not allowed, which signing in
 * again won't change (as hours.ts `fail`); anything else is the pod saying no.
 */
function readFailure(res: Response, what: string): PublishError {
  if (res.status === 401) return new PublishError("expired", `${what}: the pod refused this session (401).`, 401);
  if (res.status === 403) return new PublishError("no-control", `${what}: this account may not read it (403).`, 403);
  return new PublishError("refused", `${what} (${res.status}).`, res.status);
}

/** Whether a resource is there: true, false on a 404 only; a 401/403 or any other refusal throws. */
async function exists(url: string, fetchImpl: Fetch): Promise<boolean> {
  const res = await send(fetchImpl, url, { method: "HEAD" });
  if (res.status === 404) return false;
  if (!res.ok) throw readFailure(res, `Could not check ${url}`);
  return true;
}

/** What a stranger gets: no session, no cookie, exactly 200 with no redirect, and it reads as a collective. */
async function readableByAnyone(configUrl: string, anonFetch: Fetch): Promise<boolean> {
  try {
    const res = await send(anonFetch, configUrl, { headers: { Accept: "text/turtle" }, credentials: "omit" });
    if (res.status !== 200 || res.redirected) return false;
    parseCollectiveConfig(await res.text(), configUrl);
    return true;
  } catch {
    // No answer (or the browser blocked it) proves nothing public: an invitation would not open either.
    return false;
  }
}

/**
 * What the pod says about the network as a collective, read now, signed in, and `config.ttl` once more as a
 * stranger (an invitation is opened before sign-in). Home's own config is one whose `rdfs:seeAlso` names this
 * pod's `space.ttl`. Throws a PublishError: `expired` on a 401, `no-control` on a 403 (never read as
 * "missing"), `unreadable` when `config.ttl` is there and can't be used (it doesn't parse, or names a roster
 * or an inbox outside this pod), `unreachable`, `refused`.
 */
export async function readCollective(podRoot: string, fetchImpl: Fetch = signedIn, anonFetch: Fetch = stranger): Promise<CollectiveState> {
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
  const [roster, inbox, open] = await Promise.all([
    exists(collective.roster, fetchImpl),
    exists(collective.inbox, fetchImpl),
    readableByAnyone(configUrl, anonFetch),
  ]);
  const missing: Part[] = [...(roster ? [] : ["roster" as const]), ...(inbox ? [] : ["inbox" as const]), ...(open ? [] : ["public" as const])];
  const ours = seeAlso.some((url) => url.split("#")[0] === spaceFileUrl(root));
  if (missing.length) return { state: ours ? "incomplete" : "foreign", configUrl, collective, missing, seeAlso };
  return { state: "done", configUrl, collective, link: inviteLink(configUrl), seeAlso, ours };
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

/**
 * A new file: PUT with `If-None-Match: *`. "made", or "there": something is already there, and is kept. A
 * container that exists answers 409 on CSS 7.3 ("Existing containers cannot be updated via PUT") before it
 * looks at If-None-Match: that is "there" too, as writeSpaceFile reads 412 and 409.
 */
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
  if (res.status === 412 || (container && res.status === 409)) return "there";
  if (!res.ok) fail(res, what);
  return "made";
}

/**
 * The named agents a resource gets today from the folder above it (a second coordinator, the collective's own
 * agent): a new `.acl` replaces inheritance, so they are copied into it, as makePublic copies them. Never a
 * class (anyone, anyone signed in). Rules this app can't read there (a group, an origin) stop the write: copying
 * them is not possible, and dropping them would take access away unseen.
 */
async function inheritedAgents(resource: string, owner: string): Promise<AgentGrant[]> {
  const folder = await getAccess(new URL(resource.endsWith("/") ? "../" : "./", resource).href, owner);
  if (folder.unknown.length) {
    throw new PublishError("rules-unknown", `The folder above ${resource} passes on rules this app doesn't understand (${folder.unknown.join(", ")}): left alone.`);
  }
  return folder.inherits.agents;
}

/**
 * The inbox (createInbox, solid-backoffice @ ea20fad newcomer.ts:18): the container, then anyone signed in may
 * Append and only the owner (and the agents the folder already let in) reads. Rules of its own that already let
 * anyone signed in append are left as they are; rules of its own with folder-only grants (no acl:default) are
 * refused, because rewriting them would widen each one to everything in the inbox.
 */
async function createInbox(inbox: string, owner: string, fetchImpl: Fetch): Promise<void> {
  await putNew(fetchImpl, inbox, "", "Creating the inbox");
  const what = "Could not set who can write to the inbox";
  try {
    const access = await getAccess(inbox, owner);
    if (!access.inherited) {
      if (access.authenticated.includes("append")) return;
      if (access.folderOnly.length) {
        throw new PublishError("rules-unknown", `The inbox's rules hold grants on the folder only (${access.folderOnly.join(", ")}); rewriting them would widen them: left alone.`);
      }
      await setAuthenticatedAccess(inbox, owner, [...new Set<Mode>([...access.authenticated, "append"])]);
      return;
    }
    const agents = await inheritedAgents(inbox, owner);
    await setAccess(inbox, owner, { agents, public: [], authenticated: ["append"] }, null);
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
 * The roster, empty, then rules of its own: the owner, and the agents the folder already let in; never anyone or
 * anyone signed in. On a fresh setup a roster already there is adopted only if it holds nobody (no statement at
 * all, as a run that never finished left it); one that holds something isn't home's, and stops the setup. Rules
 * are written only when it has none of its own: a roster with rules of its own is never narrowed.
 */
async function writeRoster(roster: string, group: string, owner: string, fresh: boolean, fetchImpl: Fetch): Promise<void> {
  const made = await putNew(fetchImpl, roster, rosterTurtle(group), "Creating the roster");
  if (made === "there") {
    if (!fresh) return;
    const res = await send(fetchImpl, roster, { headers: { Accept: "text/turtle" } });
    if (!res.ok) throw readFailure(res, "Could not read the roster already there");
    const text = await res.text();
    let empty: boolean;
    try {
      empty = text === rosterTurtle(group) || parse(text, roster).length === 0;
    } catch {
      empty = false;
    }
    if (!empty) throw new PublishError("taken", `${roster} is already there and holds something: left alone, and not used as the roster.`);
  }
  const what = "Could not set who can read the roster";
  try {
    if (!(await getAccess(roster, owner)).inherited) return;
    const agents = await inheritedAgents(roster, owner);
    await setAccess(roster, owner, { agents, public: [], authenticated: [] }, null);
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

/** `config.ttl`, opened to anyone: the backoffice reads it before sign-in. Only ever home's own config. */
async function openConfig(configUrl: string, owner: string, deps: Required<SetUpDeps>): Promise<void> {
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

/** `config.ttl`, written once (`If-None-Match: *`). "there": someone made one meanwhile; it is kept. */
async function writeConfig(configUrl: string, body: string, fetchImpl: Fetch): Promise<"made" | "there"> {
  return putNew(fetchImpl, configUrl, body, "Writing config.ttl");
}

const notOurs = (configUrl: string) =>
  new PublishError("taken", `${configUrl} was not written by this app (it doesn't link to this pod's space.ttl): left alone.`);

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
 * returned as it is, with nothing written; home's own unfinished config names the parts to make; a config home
 * didn't write is never finished, opened or linked to from here. Read last: what it returns is what the pod says.
 * Throws a PublishError (expired, no-control, conflict, gone, unreadable, rules-unknown, rules-wider, not-public,
 * taken, unreachable, refused, unconfirmed, incomplete).
 */
export async function setUpCollective(input: SetUpInput, deps: SetUpDeps = {}): Promise<CollectiveState> {
  const d: Required<SetUpDeps> = { fetch: deps.fetch ?? signedIn, anonFetch: deps.anonFetch ?? stranger };
  const root = withRoot(input.podRoot);
  const before = await readCollective(root, d.fetch, d.anonFetch);
  if (before.state === "done") {
    // Done, and home's own run whose last step (the link back from space.ttl) failed is finished here. A config
    // home didn't write (Maakbib's) is done as it is: nothing more is even read.
    if (!before.ours) return before;
    const space = await readSpaceFile(input.spaceFile, d.fetch);
    if ((before.seeAlso ?? []).includes(space.subject)) await linkSpace(input.spaceFile, before.collective.group, d.fetch);
    return before;
  }
  if (before.state === "foreign") throw notOurs(before.configUrl);
  const fresh = before.state === "none";
  const name = input.name.trim();
  if (fresh && !name) throw new PublishError("incomplete", "The network's file has no name to give the collective.");

  // The network's file first, read only: where config.ttl's link goes, and a file that can be patched later.
  const space = (await readSpaceFile(input.spaceFile, d.fetch)).subject;
  const slug = fresh ? slugify(name, "network") : "";
  const group = fresh ? `${before.configUrl}#${slug}` : before.collective.group;
  const roster = fresh ? new URL("membres.ttl", root).href : before.collective.roster;
  const inbox = fresh ? new URL("inbox/", root).href : before.collective.inbox;
  const missing: readonly Part[] = fresh ? ["inbox", "roster", "public"] : before.missing;

  if (missing.includes("inbox") && !inbox.endsWith("/")) throw new PublishError("unreadable", `${before.configUrl} names an inbox that isn't a folder (${inbox}): left alone.`);
  if (missing.includes("inbox")) await createInbox(inbox, input.webId, d.fetch);
  if (missing.includes("roster")) await writeRoster(roster, group, input.webId, fresh, d.fetch);
  if (fresh) {
    const body = configTurtle({ slug, name, slogan: input.slogan, description: input.description, roster, inbox, space, root });
    if ((await writeConfig(before.configUrl, body, d.fetch)) === "there") {
      // Made meanwhile: opened and linked to only if it is home's own (another tab of this app).
      const now = await readCollective(root, d.fetch, d.anonFetch);
      if (now.state === "foreign" || (now.state === "done" && !now.ours)) throw notOurs(before.configUrl);
    }
  }
  if (missing.includes("public")) await openConfig(before.configUrl, input.webId, d);

  // What the pod holds now.
  const after = await readCollective(root, d.fetch, d.anonFetch);
  if (after.state !== "done") throw new PublishError("unconfirmed", "Set up, but reading it back doesn't show a whole collective.");
  if (!after.ours) throw notOurs(after.configUrl);
  await linkSpace(input.spaceFile, after.collective.group, d.fetch);
  return after;
}
