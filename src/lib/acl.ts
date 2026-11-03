/**
 * WAC access rules, read with a real Turtle parser and written as hand-written
 * Turtle (solid-kit ADR 003).
 *
 * Ported from pocpod0/backoffice/pod-api.js, which found out the hard way that
 * `universalAccess` writes container grants without `acl:default`. The four
 * load-bearing details from that ADR are all here, and each is tested:
 *
 * 1. The target is resolved explicitly. From `<file>.acl`, a relative `./`
 *    is the PARENT CONTAINER, so a file's target is `./<name>`, never `./`.
 * 2. The owner block is always re-emitted with Read, Write and Control.
 * 3. An authorization this module does not understand is a refusal, not a
 *    rewrite — rewriting would silently delete someone's grant.
 * 4. WebIDs are validated before they are spliced into Turtle.
 *
 * Two things changed from the old code, on purpose:
 *
 * - The `.acl` location comes from the `Link: rel="acl"` header, as the spec
 *   says, not from appending ".acl". It happens to be the same on CSS today.
 * - Writes are conditional (`If-Match` / `If-None-Match`). The backoffice is not
 *   the only ACL writer: the MCP connector's grant tool and CSS itself write
 *   them too, and an unconditional PUT would erase their change unseen.
 *
 * WAC only. ACP (`.acr`) is a different model; see ADR 003 before the switch.
 *
 * Copied whole from solid-backoffice `src/lib/acl.ts` at c9243b3 (with its tests), as
 * register.ts was: home uses `getAccess` and `setPublicAccess` (Story 14.4 S2, #12;
 * 14.6 reuses them for a logo). Keep it identical to the backoffice's until the kit
 * ships it as a package; a fix lands there first.
 */
import { Parser, type Quad } from "n3";
import { authFetch } from "./auth";
import { readWithEtag, writeIfMatch, type ConditionalError } from "./conditional";
import { readTurtle } from "./read";
import { advertisesStorageType } from "./pod";

const ACL = "http://www.w3.org/ns/auth/acl#";
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";
const FOAF_AGENT = "http://xmlns.com/foaf/0.1/Agent";
const AUTHENTICATED = ACL + "AuthenticatedAgent";

export type Mode = "read" | "append" | "write" | "control";
export const MODES: readonly Mode[] = ["read", "append", "write", "control"];

const MODE_IRI: Record<Mode, string> = {
  read: ACL + "Read",
  append: ACL + "Append",
  write: ACL + "Write",
  control: ACL + "Control",
};
const IRI_MODE = new Map(Object.entries(MODE_IRI).map(([m, iri]) => [iri, m as Mode]));

export interface AgentGrant {
  webId: string;
  modes: Mode[];
}

/** What a resource's own `.acl` says, in the terms this module understands. */
export interface AccessRules {
  /** Named agents other than the owner. */
  agents: AgentGrant[];
  /** `acl:agentClass foaf:Agent` — anyone, signed in or not. */
  public: Mode[];
  /** `acl:agentClass acl:AuthenticatedAgent` — anyone signed in. Inboxes use it. */
  authenticated: Mode[];
  /**
   * Authorizations this module cannot represent: groups, origins, unknown
   * classes or modes, or targets other than this resource. Non-empty means
   * READ-ONLY: `setAgentAccess` refuses rather than drop them on rewrite.
   */
  unknown: string[];
  /**
   * Grants on a container that lacked `acl:default` — the universalAccess bug.
   * They cover the folder but none of its contents. Saving re-emits them WITH
   * `acl:default`, which widens them to what the grantor evidently meant; the
   * UI should say so rather than do it silently.
   */
  folderOnly: string[];
  /**
   * What reaches the folder's contents: only authorizations with
   * `acl:default`. A pod root's public Read is written without it on CSS, so
   * the root is public and what is inside is not. Empty on a file.
   */
  inherits: Pick<AccessRules, "agents" | "public" | "authenticated">;
}

export interface ResourceAccess extends AccessRules {
  aclUrl: string;
  /** No own `.acl`: the rules come from a parent. Not the same as "no access". */
  inherited: boolean;
  etag: string | null;
}

/**
 * Accepts only an http(s) URL with nothing that could close the `<…>` token it
 * is spliced into. Rejects rather than sanitizes: a "cleaned" WebID is a
 * different identity, granted access nobody asked for.
 */
export function isValidWebId(value: string): boolean {
  if (!/^https?:\/\/[^\s<>"{}|\\^`]+$/.test(value)) return false;
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

/** The `rel="acl"` target of a Link header, resolved against the resource. */
export function aclUrlFromLink(linkHeader: string | null, resourceUrl: string): string | null {
  if (!linkHeader) return null;
  for (const entry of linkHeader.match(/<[^>]*>[^,]*/g) ?? []) {
    const target = entry.match(/^<([^>]*)>/)?.[1];
    if (target !== undefined && /rel\s*=\s*"?acl"?(\s|;|$|")/i.test(entry)) {
      return new URL(target, resourceUrl).href;
    }
  }
  return null;
}

function emptyRules(): AccessRules {
  return { agents: [], public: [], authenticated: [], unknown: [], folderOnly: [], inherits: { agents: [], public: [], authenticated: [] } };
}

function sortModes(modes: Iterable<Mode>): Mode[] {
  const set = new Set(modes);
  return MODES.filter((m) => set.has(m));
}

/**
 * Parses an `.acl` document. The owner's own authorizations are dropped from
 * `agents`: the owner block is re-emitted on every write regardless (rule 2).
 */
export function parseAcl(
  turtle: string,
  aclUrl: string,
  resourceUrl: string,
  ownerWebId: string
): AccessRules {
  const quads: Quad[] = new Parser({ baseIRI: aclUrl }).parse(turtle);
  const bySubject = new Map<string, Quad[]>();
  for (const q of quads) {
    const list = bySubject.get(q.subject.value) ?? [];
    list.push(q);
    bySubject.set(q.subject.value, list);
  }

  const rules = emptyRules();
  const agentModes = new Map<string, Set<Mode>>();
  const pub = new Set<Mode>();
  const auth = new Set<Mode>();
  const inhAgents = new Map<string, Set<Mode>>();
  const inhPub = new Set<Mode>();
  const inhAuth = new Set<Mode>();
  const isContainer = resourceUrl.endsWith("/");

  for (const [subject, props] of bySubject) {
    const isAuthorization = props.some(
      (q) => q.predicate.value === RDF_TYPE && q.object.value === ACL + "Authorization"
    );
    if (!isAuthorization) continue;

    const values = (p: string) => props.filter((q) => q.predicate.value === ACL + p);
    const accessTo = values("accessTo").map((q) => q.object.value);
    const defaults = values("default").map((q) => q.object.value);
    const agents = values("agent").map((q) => q.object.value);
    const classes = values("agentClass").map((q) => q.object.value);
    const modeIris = values("mode").map((q) => q.object.value);
    const modes = modeIris.map((iri) => IRI_MODE.get(iri));

    const understood =
      values("agentGroup").length === 0 &&
      values("origin").length === 0 &&
      values("accessToClass").length === 0 &&
      values("defaultForNew").length === 0 &&
      accessTo.length === 1 &&
      accessTo[0] === resourceUrl &&
      defaults.every((d) => d === resourceUrl) &&
      (isContainer || defaults.length === 0) &&
      classes.every((c) => c === FOAF_AGENT || c === AUTHENTICATED) &&
      agents.length + classes.length > 0 &&
      modes.length > 0 &&
      modes.every((m) => m !== undefined);

    if (!understood) {
      rules.unknown.push(subject);
      continue;
    }
    if (isContainer && defaults.length === 0) rules.folderOnly.push(subject);

    for (const agent of agents) {
      if (agent === ownerWebId) continue;
      const set = agentModes.get(agent) ?? new Set<Mode>();
      modes.forEach((m) => set.add(m!));
      agentModes.set(agent, set);
    }
    for (const c of classes) {
      const target = c === FOAF_AGENT ? pub : auth;
      modes.forEach((m) => target.add(m!));
    }
    if (isContainer && defaults.length > 0) {
      for (const agent of agents) {
        if (agent === ownerWebId) continue;
        const set = inhAgents.get(agent) ?? new Set<Mode>();
        modes.forEach((m) => set.add(m!));
        inhAgents.set(agent, set);
      }
      for (const c of classes) modes.forEach((m) => (c === FOAF_AGENT ? inhPub : inhAuth).add(m!));
    }
  }

  rules.agents = [...agentModes].map(([webId, set]) => ({ webId, modes: sortModes(set) }));
  rules.public = sortModes(pub);
  rules.authenticated = sortModes(auth);
  rules.inherits = {
    agents: [...inhAgents].map(([webId, set]) => ({ webId, modes: sortModes(set) })),
    public: sortModes(inhPub),
    authenticated: sortModes(inhAuth),
  };
  return rules;
}

/**
 * How the resource is named from inside its `.acl` (rule 1).
 *
 * Relative when the ACL sits beside the resource, so a copied pod keeps its
 * rules; absolute otherwise, because a relative guess against an ACL stored
 * elsewhere would point at the wrong thing.
 */
export function aclTarget(resourceUrl: string, aclUrl: string): string {
  const dir = new URL("./", aclUrl).href;
  if (resourceUrl === dir) return "./";
  if (resourceUrl.startsWith(dir)) {
    const rest = resourceUrl.slice(dir.length);
    // A file directly in the ACL's folder: "./name". Never "./" — that is the
    // folder itself, and would grant the whole folder instead of one file.
    if (rest && !rest.slice(0, -1).includes("/")) return "./" + rest;
  }
  return resourceUrl;
}

/** Writes the whole `.acl` document. Refuses invalid WebIDs (rule 4). */
export function serializeAcl(
  resourceUrl: string,
  aclUrl: string,
  ownerWebId: string,
  rules: Pick<AccessRules, "agents" | "public" | "authenticated">
): string {
  for (const id of [ownerWebId, ...rules.agents.map((a) => a.webId)]) {
    if (!isValidWebId(id)) throw new Error(`Not a valid WebID: ${id}`);
  }
  const target = aclTarget(resourceUrl, aclUrl);
  const isContainer = resourceUrl.endsWith("/");
  const modeList = (modes: Mode[]) =>
    sortModes(modes).map((m) => "acl:" + m[0].toUpperCase() + m.slice(1)).join(", ");

  const block = (id: string, who: string, modes: Mode[]) =>
    [
      `<#${id}>`,
      "    a acl:Authorization;",
      `    ${who};`,
      `    acl:accessTo <${target}>;`,
      ...(isContainer ? [`    acl:default <${target}>;`] : []),
      `    acl:mode ${modeList(modes)}.`,
    ].join("\n");

  const blocks = [
    "@prefix acl: <http://www.w3.org/ns/auth/acl#>.\n@prefix foaf: <http://xmlns.com/foaf/0.1/>.",
    // Rule 2: never lock yourself out.
    block("owner", `acl:agent <${ownerWebId}>`, ["read", "write", "control"]),
  ];
  rules.agents
    .filter((a) => a.webId !== ownerWebId && a.modes.length > 0)
    .forEach((a, i) => blocks.push(block(`grant${i}`, `acl:agent <${a.webId}>`, a.modes)));
  if (rules.authenticated.length > 0) {
    blocks.push(block("authenticated", "acl:agentClass acl:AuthenticatedAgent", rules.authenticated));
  }
  if (rules.public.length > 0) {
    blocks.push(block("public", "acl:agentClass foaf:Agent", rules.public));
  }
  return blocks.join("\n\n") + "\n";
}

/**
 * Where each resource's `.acl` lives, from its `Link: rel="acl"` header. The
 * location of a resource's ACL does not change, so it is asked once per
 * session (a HEAD is a round trip on every share check otherwise). Whether
 * the `.acl` exists is never kept: that is read each time. Memory only.
 */
const aclLocations = new Map<string, string>();

/** The `.acl` address of a resource; `fresh` asks the server even if known. */
export async function aclLocation(resourceUrl: string, fresh = false): Promise<string> {
  const known = aclLocations.get(resourceUrl);
  if (known && !fresh) return known;
  const head = await authFetch(resourceUrl, { method: "HEAD" });
  if (!head.ok) {
    aclLocations.delete(resourceUrl);
    const err = new Error(`Could not reach ${resourceUrl} (${head.status}).`) as ConditionalError;
    err.status = head.status;
    throw err;
  }
  const aclUrl = aclUrlFromLink(head.headers.get("link"), resourceUrl);
  if (!aclUrl) throw new Error(`${resourceUrl} advertises no access-control document.`);
  aclLocations.set(resourceUrl, aclUrl);
  return aclUrl;
}

/** Forgets the ACL locations of a resource and everything under it (after a delete or move). */
export function forgetAclLocations(prefix?: string): void {
  if (prefix === undefined) return aclLocations.clear();
  for (const url of [...aclLocations.keys()]) if (url.startsWith(prefix)) aclLocations.delete(url);
}

/**
 * Finds the resource's ACL and reads it, with its ETag: the base of a write.
 * Always asks the server where the ACL is and reads it without a kept copy
 * (conditional.ts, invariant 1).
 */
export async function getAccess(resourceUrl: string, ownerWebId: string): Promise<ResourceAccess> {
  const aclUrl = await aclLocation(resourceUrl, true);
  try {
    const { text, etag } = await readWithEtag(aclUrl);
    return { ...parseAcl(text, aclUrl, resourceUrl, ownerWebId), aclUrl, etag, inherited: false };
  } catch (err) {
    if ((err as ConditionalError).status === 404) {
      return { ...emptyRules(), aclUrl, etag: null, inherited: true };
    }
    throw err;
  }
}

/**
 * The same, for showing: the ACL's location from memory and the document
 * revalidated through read.ts (ADR 007). Never the base of a write.
 */
export async function readAccess(resourceUrl: string, ownerWebId: string): Promise<ResourceAccess> {
  const aclUrl = await aclLocation(resourceUrl);
  const res = await readTurtle(aclUrl);
  if (res.status === 404) return { ...emptyRules(), aclUrl, etag: null, inherited: true };
  if (!res.ok) {
    const err = new Error(`Could not read ${aclUrl} (${res.status}).`) as ConditionalError;
    err.status = res.status;
    throw err;
  }
  const rules = parseAcl(await res.text(), aclUrl, resourceUrl, ownerWebId);
  return { ...rules, aclUrl, etag: res.headers.get("etag"), inherited: false };
}

/**
 * Sets one agent's modes on a resource; an empty list removes the agent.
 *
 * When the resource has no own `.acl`, the new one REPLACES inheritance: after
 * this, only the owner and what is written here apply to it. That is why the
 * caller passes the whole intended state, and why the owner block is always in it.
 */
export async function setAgentAccess(
  resourceUrl: string,
  ownerWebId: string,
  agentWebId: string,
  modes: Mode[]
): Promise<void> {
  if (!isValidWebId(agentWebId)) throw new Error(`Not a valid WebID: ${agentWebId}`);
  await updateAccess(resourceUrl, ownerWebId, (rules) => ({
    ...rules,
    agents: [
      ...rules.agents.filter((a) => a.webId !== agentWebId),
      ...(modes.length ? [{ webId: agentWebId, modes: sortModes(modes) }] : []),
    ],
  }));
}

/** Sets the modes for everyone signed in (`acl:AuthenticatedAgent`). */
export async function setAuthenticatedAccess(
  resourceUrl: string,
  ownerWebId: string,
  modes: Mode[]
): Promise<void> {
  await updateAccess(resourceUrl, ownerWebId, (rules) => ({ ...rules, authenticated: sortModes(modes) }));
}

/** "Can read" and "Can edit" (slice C2). Control is never granted from the screen. */
export const PRESETS = {
  read: ["read"] as Mode[],
  edit: ["read", "append", "write"] as Mode[],
};

/** The preset a set of modes matches, or null: shown as "Custom", changed only in the technical rules. */
export function presetOf(modes: Mode[]): keyof typeof PRESETS | null {
  const key = sortModes(modes).join(",");
  if (key === PRESETS.read.join(",")) return "read";
  if (key === PRESETS.edit.join(",")) return "edit";
  return null;
}

/** Someone changed the rules after the screen read them: nothing is written. */
function changedMeanwhile(url: string): ConditionalError {
  const err = new Error(
    `The access rules of ${url} changed after this screen read them. Nothing was saved; they are shown again as they are now.`
  ) as ConditionalError;
  err.code = "conflict";
  err.status = 412;
  return err;
}

/**
 * Writes the whole intended state of a resource's rules (the permissions
 * panel's Save), only if they are still what the screen showed: `basedOn` is
 * the ETag it read, `null` when the resource had no rules of its own. An
 * item without its own `.acl` gets one, which replaces inheritance.
 */
export async function setAccess(
  resourceUrl: string,
  ownerWebId: string,
  next: Pick<AccessRules, "agents" | "public" | "authenticated">,
  basedOn: string | null
): Promise<void> {
  for (const a of next.agents) if (!isValidWebId(a.webId)) throw new Error(`Not a valid WebID: ${a.webId}`);
  const current = await getAccess(resourceUrl, ownerWebId);
  if ((current.inherited ? null : current.etag) !== basedOn) throw changedMeanwhile(resourceUrl);
  if (current.unknown.length > 0) {
    throw new Error(
      "These access rules include something this app does not understand yet. " +
        "Editing them here would silently delete it, so nothing was changed."
    );
  }
  const body = serializeAcl(resourceUrl, current.aclUrl, ownerWebId, {
    agents: next.agents.map((a) => ({ webId: a.webId, modes: sortModes(a.modes) })),
    public: sortModes(next.public),
    authenticated: sortModes(next.authenticated),
  });
  try {
    if (current.inherited) await createOnly(current.aclUrl, body);
    else await writeIfMatch(current.aclUrl, body, current.etag);
  } catch (err) {
    if ((err as ConditionalError).status === 412) throw changedMeanwhile(resourceUrl);
    throw err;
  }
}

/** Sets the modes for anyone, signed in or not (`foaf:Agent`): "Anyone with the link". */
export async function setPublicAccess(resourceUrl: string, ownerWebId: string, modes: Mode[]): Promise<void> {
  await updateAccess(resourceUrl, ownerWebId, (rules) => ({ ...rules, public: sortModes(modes) }));
}

/**
 * Restore from parent: removes the resource's own `.acl`, so the rules of the
 * folder above apply again. Refused on a pod root (it has no parent, and
 * without its `.acl` nobody could reach the pod), and when the rules changed
 * since the screen read them.
 */
export async function removeOwnRules(resourceUrl: string, basedOn: string | null): Promise<void> {
  const head = await authFetch(resourceUrl, { method: "HEAD" });
  if (!head.ok) {
    const err = new Error(`Could not reach ${resourceUrl} (${head.status}).`) as ConditionalError;
    err.status = head.status;
    throw err;
  }
  if (advertisesStorageType(head.headers.get("link"))) {
    throw new Error("A pod's root has no folder above it: its rules cannot be removed.");
  }
  const aclUrl = aclUrlFromLink(head.headers.get("link"), resourceUrl);
  if (!aclUrl) throw new Error(`${resourceUrl} advertises no access-control document.`);
  if (!basedOn) throw changedMeanwhile(resourceUrl);
  const res = await authFetch(aclUrl, { method: "DELETE", headers: { "If-Match": basedOn } });
  if (res.status === 412 || res.status === 404) throw changedMeanwhile(resourceUrl);
  if (!res.ok) {
    const err = new Error(`Could not remove ${aclUrl} (${res.status}).`) as ConditionalError;
    err.status = res.status;
    throw err;
  }
}

/* ── The technical rules, edited by hand (C6) ──────────────────────────── */

/** What the raw editor checks before Save is allowed. */
export interface RawCheck {
  /** Why the text is not Turtle; null when it parses. */
  parseError: string | null;
  /** The owner is named with Control over the resource (and `acl:default` on a folder). */
  ownerKeepsControl: boolean;
  /** The rules as the simple panel reads them; null when the text does not parse. */
  rules: AccessRules | null;
}

export function checkRawAcl(turtle: string, resourceUrl: string, aclUrl: string, ownerWebId: string): RawCheck {
  let quads: Quad[];
  try {
    quads = new Parser({ baseIRI: aclUrl }).parse(turtle);
  } catch (err) {
    return { parseError: (err as Error).message, ownerKeepsControl: false, rules: null };
  }
  const isContainer = resourceUrl.endsWith("/");
  const has = (s: string, p: string, o: string) => quads.some((q) => q.subject.value === s && q.predicate.value === ACL + p && q.object.value === o);
  const subjects = new Set(
    quads.filter((q) => q.predicate.value === RDF_TYPE && q.object.value === ACL + "Authorization").map((q) => q.subject.value)
  );
  const ownerKeepsControl = [...subjects].some(
    (s) =>
      has(s, "agent", ownerWebId) &&
      has(s, "mode", ACL + "Control") &&
      has(s, "accessTo", resourceUrl) &&
      (!isContainer || has(s, "default", resourceUrl))
  );
  return { parseError: null, ownerKeepsControl, rules: parseAcl(turtle, aclUrl, resourceUrl, ownerWebId) };
}

/**
 * Saves a hand-edited `.acl`. Refused unless it parses, the owner keeps
 * Control, and nobody changed the rules since they were read (`basedOn`:
 * the ETag read, null when the resource had no rules of its own).
 */
export async function saveRawAcl(resourceUrl: string, ownerWebId: string, turtle: string, basedOn: string | null): Promise<void> {
  const aclUrl = await aclLocation(resourceUrl, true);
  const check = checkRawAcl(turtle, resourceUrl, aclUrl, ownerWebId);
  if (check.parseError) throw new Error(`These rules are not valid Turtle: ${check.parseError} Nothing was saved.`);
  if (!check.ownerKeepsControl) {
    throw new Error("These rules would take Control away from you: you could lock yourself out. Nothing was saved.");
  }
  const res = await authFetch(aclUrl, {
    method: "PUT",
    headers: { "Content-Type": "text/turtle", ...(basedOn ? { "If-Match": basedOn } : { "If-None-Match": "*" }) },
    body: turtle,
  });
  if (res.status === 412) throw changedMeanwhile(resourceUrl);
  if (!res.ok) {
    const err = new Error(`Could not write ${aclUrl} (${res.status}).`) as ConditionalError;
    err.status = res.status;
    throw err;
  }
}

/** Read → refuse-if-unknown → transform → conditional write, one retry on 412. */
async function updateAccess(
  resourceUrl: string,
  ownerWebId: string,
  change: (rules: AccessRules) => AccessRules
): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const current = await getAccess(resourceUrl, ownerWebId);
    if (current.unknown.length > 0) {
      // Rule 3.
      throw new Error(
        "These access rules include something this app does not understand yet " +
          "(for example group or app-origin sharing). Editing them here would " +
          "silently delete it, so nothing was changed."
      );
    }
    const body = serializeAcl(resourceUrl, current.aclUrl, ownerWebId, change(current));
    try {
      if (current.inherited) {
        await createOnly(current.aclUrl, body);
      } else {
        await writeIfMatch(current.aclUrl, body, current.etag);
      }
      return;
    } catch (err) {
      if ((err as ConditionalError).status !== 412 || attempt === 1) throw err;
    }
  }
}

/** PUT that fails with 412 if someone created the document in the meantime. */
async function createOnly(url: string, body: string): Promise<void> {
  const res = await authFetch(url, {
    method: "PUT",
    headers: { "Content-Type": "text/turtle", "If-None-Match": "*" },
    body,
  });
  if (!res.ok) {
    const err = new Error(`Could not write ${url} (${res.status}).`) as ConditionalError;
    err.status = res.status;
    err.code = "write-failed";
    throw err;
  }
}
