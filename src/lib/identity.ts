/**
 * What tells one WebID apart from another, without what doesn't.
 *
 * `https://pod.example.org/nicolas/profile/card#me` fits in `nicolas`. The
 * scheme and host repeat across every identity on the same provider, and
 * `/profile/card#me` is the convention nearly every Solid server writes —
 * three pieces that used to fill a topbar while the one piece that actually
 * distinguishes an identity, at the end, was exactly what a trailing ellipsis
 * cut off first.
 *
 * Always keep the full WebID somewhere retrievable (a `title` attribute, a
 * details view) — it is the value to copy, verify, or paste into a support
 * ticket. This is a display shortcut, not a replacement.
 */
export function shortWebId(webId: string): string {
  try {
    const url = new URL(webId);
    const path = url.pathname.replace(/\/profile\/card$/, "").replace(/^\/|\/$/g, "");
    // An identity hosted at the pod root has nothing left to show but its host.
    return path || url.host;
  } catch {
    return webId;
  }
}
