/**
 * The generic pod layer: finding the pod root, making sure containers exist,
 * and telling an auth failure apart from a missing resource.
 *
 * Deliberately domain-free. An app's own reads and writes belong in the app,
 * using `@inrupt/solid-client` directly with `authFetch` from `./auth` — there
 * is no generic read/write wrapper here because no two apps in this ecosystem
 * have wanted the same one.
 */
import {
  getSolidDataset,
  getPodUrlAll,
  createContainerAt,
  FetchError,
} from "@inrupt/solid-client";
import { authFetch as fetch } from "./auth";

const STORAGE_TYPE = "http://www.w3.org/ns/pim/space#Storage";

/**
 * True if the Link header advertises `rel="type"` pointing at pim:Storage.
 * Exported for tests — header parsing is fiddly enough to be worth pinning.
 */
export function advertisesStorageType(linkHeader: string | null): boolean {
  if (!linkHeader) return false;
  const entries = linkHeader.match(/<[^>]*>[^,]*/g) ?? [];
  return entries.some((entry) => {
    const target = entry.match(/^<([^>]*)>/)?.[1];
    return target === STORAGE_TYPE && /rel\s*=\s*"?type"?/i.test(entry);
  });
}

/**
 * Walks up the URI path hierarchy looking for the storage root, as the Solid
 * protocol requires every server to advertise it:
 * `Link: <http://www.w3.org/ns/pim/space#Storage>; rel="type"`.
 *
 * STOP AT THE FIRST MATCH. A multi-pod server advertises pim:Storage on its own
 * server root as well, so continuing past the first hit returns the server root
 * instead of the user's pod — wrong, and not writable.
 */
export async function findStorageByLinkHeaders(startUrl: string): Promise<string | null> {
  const start = new URL(startUrl);
  start.hash = "";
  start.search = "";

  const candidates = [start.toString()];
  let path = start.pathname;
  while (path !== "/") {
    path = path.replace(/[^/]*\/?$/, "");
    candidates.push(new URL(path, start.origin).toString());
  }

  for (const url of candidates) {
    try {
      const res = await fetch(url, { method: "HEAD" });
      if (res.ok && advertisesStorageType(res.headers.get("link"))) return url;
    } catch {
      // Unreachable ancestor: keep walking up.
    }
  }
  return null;
}

/**
 * The pod root, in two tiers — and the order matters:
 *
 * 1. the `pim:storage` triple in the WebID profile. Canonical, one fetch.
 * 2. failing that, the Link-header walk above — needed for pods created before
 *    servers wrote `pim:storage` at signup, whose profiles lack the triple.
 *
 * Do NOT add a third tier that derives the root by string-parsing the WebID.
 * It happens to work for the `/<user>/profile/card` layout and has no basis in
 * the spec: identity and storage are decoupled on purpose, and a user whose
 * WebID lives on their own domain (the portability path) breaks it immediately.
 */
export async function getPrimaryPodUrl(webId: string): Promise<string> {
  try {
    const pods = await getPodUrlAll(webId, { fetch });
    if (pods.length > 0) return pods[0];
  } catch {
    // Profile unreadable or triple absent: fall through to header discovery.
  }

  const storage = await findStorageByLinkHeaders(webId);
  if (storage) return storage;

  throw new Error(
    "Could not find the pod root: no pim:storage triple in the WebID profile, " +
      "and no pim:Storage Link header on any parent container."
  );
}

/** Creates the container if it is missing. Idempotent. */
export async function ensureContainer(url: string): Promise<void> {
  try {
    await getSolidDataset(url, { fetch });
  } catch (err) {
    if (err instanceof FetchError && err.statusCode === 404) {
      await createContainerAt(url, { fetch });
      return;
    }
    throw err;
  }
}

/**
 * Existence probe. Note that on a private pod this throws rather than returning
 * false once the token expires — route the error through `isAuthError`.
 */
export async function exists(url: string): Promise<boolean> {
  try {
    await getSolidDataset(url, { fetch });
    return true;
  } catch (err) {
    if (err instanceof FetchError && err.statusCode === 404) return false;
    throw err;
  }
}

/**
 * True when the failure is about authentication rather than the resource.
 *
 * On a private pod an expired token makes *everything* answer 401, existence
 * probes included — so a raw 401 says nothing about whether the resource is
 * there. Every catch block that inspects a status code needs this first.
 */
export function isAuthError(err: unknown): boolean {
  return err instanceof FetchError && (err.statusCode === 401 || err.statusCode === 403);
}

/**
 * Short but diagnosable. The server's error graph is unreadable; the URL and
 * the status code are exactly what is needed to know which resource refused.
 */
export function describePodError(err: unknown): string {
  if (!(err instanceof FetchError)) {
    return err instanceof Error ? err.message : String(err);
  }
  const url = err.message.match(/at \[([^\]]+)\]/)?.[1] ?? "an unknown resource";
  if (isAuthError(err)) {
    return `Access refused (${err.statusCode}) on ${url} — the session has expired, or this pod does not belong to your account.`;
  }
  return `Request failed (${err.statusCode}) on ${url}.`;
}

/**
 * Filename-safe slug from a human title. Accents are folded rather than
 * dropped, so "Échauffement" stays "echauffement" instead of "chauffement".
 */
export function slugify(title: string, fallback = "item"): string {
  const slug = title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return slug || fallback;
}

/**
 * `2026-08-29` in LOCAL time — the day the user thinks they did the thing, not
 * the UTC day. Filenames built from this are a hint for cheap listing; the
 * document's own timestamp stays authoritative.
 */
export function isoDate(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
