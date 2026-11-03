/**
 * Tile C, the logo (Story 14.6 S6, AC6, #41): uploaded to the pod, not typed.
 *
 * The image goes next to `space.ttl` as `logo`, one name whatever its type, so
 * replacing it never changes the address `schema:logo` holds and the access
 * rules are written once, with the first upload. Then, in order:
 *
 * 1. Checked before anything is written: PNG, JPEG or WebP by its own first
 *    bytes (what the browser says about a file is not trusted), up to 512 KB.
 *    No SVG yet: a public SVG opened directly runs in the pod server's origin
 *    (vps-infra#15); it comes back once the pod site sandboxes uploads.
 * 2. Written: created only if nobody has (`If-None-Match: *`); replaced only if
 *    `schema:logo` already points at it, and only the version just read
 *    (`If-Match`). A `logo` the space doesn't point at is someone's file: left
 *    alone. The bytes go with the type sniffed, never the browser's.
 * 3. Opened to anyone, that one file (publish.ts `makePublic`, 14.4's helper),
 *    and proved by a stranger's read: 200, and the type written.
 * 4. Only then `schema:logo` points at it, one statement (hours.ts
 *    `changeStatement`), so the card never shows a broken image.
 *
 * Ported from solid-backoffice `lib/files.ts` (`createOnly`, `uploadFile`,
 * `storedSize`): 412/409 mean something is already there, 413 is the
 * gateway's limit, and a failed write is checked for bytes the server kept.
 * The backoffice's progress bar is left out: a logo is small.
 *
 * A typed address still works (`saveLogoAddress`): a logo hosted elsewhere.
 */
import { authFetch } from "./auth";
import { changeStatement, iri, type StatementResult } from "./hours";
import { makePublic, PublishError, send, spaceFileUrl, type PublicResult } from "./publish";

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

const LOGO = "https://schema.org/logo";
export const LOGO_MAX = 512 * 1024;
export const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export type LogoType = (typeof LOGO_TYPES)[number];

/** The logo's one address on the pod: next to the space file. */
export const logoUrl = (podRoot: string) => new URL("logo", podRoot.endsWith("/") ? podRoot : podRoot + "/").href;

/** The image's type from its first bytes; null when it is none of the three. */
export function sniffLogo(head: Uint8Array): LogoType | null {
  const at = (i: number, bytes: number[]) => bytes.every((b, k) => head[i + k] === b);
  if (at(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (at(0, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (at(0, [0x52, 0x49, 0x46, 0x46]) && at(8, [0x57, 0x45, 0x42, 0x50])) return "image/webp";
  return null;
}

/** The checks before any write: a refusal says why in the code (too-large, not-image). */
export async function checkLogo(file: Blob): Promise<LogoType> {
  if (file.size > LOGO_MAX) throw new PublishError("too-large", `The image is ${Math.ceil(file.size / 1024)} KB; a logo is up to ${LOGO_MAX / 1024} KB.`);
  const type = file.size ? sniffLogo(new Uint8Array(await file.slice(0, 16).arrayBuffer())) : null;
  if (!type) throw new PublishError("not-image", "Not a PNG, JPEG or WebP image.");
  return type;
}

export interface LogoResult extends StatementResult {
  /** The logo's address, as `schema:logo` now holds it. */
  url: string;
  /** Whether the file was opened to anyone now, or already was. */
  opened: PublicResult["status"] | null;
}

const failed = (res: Response, what: string): never => {
  if (res.status === 401) throw new PublishError("expired", `${what}: 401`, 401);
  if (res.status === 403) throw new PublishError("no-control", `${what}: 403`, 403);
  if (res.status === 413) throw new PublishError("too-large", `${what}: larger than this pod takes in one upload (413)`, 413);
  throw new PublishError("refused", `${what}: ${res.status}`, res.status);
};

/** What a file's size is on the pod now, or null when it is not there (backoffice `storedSize`). */
async function storedSize(fetchImpl: Fetch, url: string): Promise<number | null> {
  try {
    const res = await send(fetchImpl, url, { method: "HEAD" });
    if (!res.ok) return null;
    const length = Number(res.headers.get("content-length") ?? NaN);
    return Number.isFinite(length) ? length : null;
  } catch {
    return null;
  }
}

/** Writes the bytes: created if absent, replaced only if it is the space's logo already, at the version read. */
async function writeLogo(fetchImpl: Fetch, url: string, file: Blob, type: LogoType, current: string | null): Promise<void> {
  const head = await send(fetchImpl, url, { method: "HEAD" });
  let condition: Record<string, string>;
  if (head.status === 404) condition = { "If-None-Match": "*" };
  else if (head.ok) {
    if (current !== url) throw new PublishError("taken", "A file named logo is already next to your space file, and your space doesn't use it: left alone.");
    const etag = head.headers.get("ETag");
    if (!etag) throw new PublishError("refused", "The pod sent no ETag for the logo, so it can't be replaced safely.");
    condition = { "If-Match": etag };
  } else failed(head, "Reading the logo");

  const res = await send(fetchImpl, url, { method: "PUT", headers: { "Content-Type": type, ...condition! }, body: file });
  // 412: created or changed meanwhile. 409: CSS refuses a file where a folder of that name is.
  if (res.status === 412 || res.status === 409) {
    if (condition!["If-None-Match"]) throw new PublishError("taken", "A file named logo appeared next to your space file meanwhile: left alone.", res.status);
    throw new PublishError("conflict", "The logo changed meanwhile.", res.status);
  }
  if (!res.ok) {
    try {
      failed(res, "Writing the logo");
    } catch (err) {
      // A server can keep the bytes it received before failing (CSS does, on a 500): say so.
      const stored = await storedSize(fetchImpl, url);
      if (stored !== null && stored !== file.size) (err as Error).message += ` Only part of it was stored (${stored} of ${file.size} bytes).`;
      throw err;
    }
  }
}

/**
 * The logo, uploaded: written next to the space file, opened to anyone, proved, then pointed at.
 * `current`: what `schema:logo` says now (the space's file as read). Throws a PublishError.
 */
export async function uploadLogo(
  podRoot: string,
  webId: string,
  file: Blob,
  current: string | null,
  fetchImpl: Fetch = (u, i) => authFetch(u, i),
  anonFetch?: Fetch
): Promise<LogoResult> {
  const type = await checkLogo(file);
  const url = logoUrl(podRoot);
  await writeLogo(fetchImpl, url, file, type, current);
  const proof = (ct: string | null) => (ct ?? "").split(";")[0].trim().toLowerCase() === type;
  const opened = await makePublic(url, webId, { accept: type, anonFetch, isTheResource: (_body, ct) => proof(ct) });
  const r = await changeStatement(spaceFileUrl(podRoot), LOGO, { n3: iri(url), value: url, isSame: (q) => q.object.termType === "NamedNode" && q.object.value === url }, fetchImpl);
  return { ...r, url, opened: opened.status };
}

/** A typed address: http(s) only, a web address that can't end the IRI it is written as. Null when it isn't one. */
export function logoAddress(typed: string): string | null {
  const t = typed.trim();
  let u: URL;
  try {
    u = new URL(t);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  return /[<>"{}|^`\\\s]/.test(u.href) ? null : u.href;
}

/** A logo hosted elsewhere: only `schema:logo` changes. Throws a PublishError (not-image when it isn't a web address). */
export async function saveLogoAddress(podRoot: string, typed: string, fetchImpl: Fetch = (u, i) => authFetch(u, i)): Promise<LogoResult> {
  const url = logoAddress(typed);
  if (!url) throw new PublishError("not-image", "Not a web address (https://…).");
  const r = await changeStatement(spaceFileUrl(podRoot), LOGO, { n3: iri(url), value: url, isSame: (q) => q.object.termType === "NamedNode" && q.object.value === url }, fetchImpl);
  return { ...r, url, opened: null };
}
