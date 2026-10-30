/**
 * Login without a hardcoded OIDC provider.
 *
 * `loginWithIdentifier` accepts either an OIDC issuer URL (used as-is; the
 * provider hands back the WebID after the redirect) or a WebID (whose profile
 * document is fetched for its `solid:oidcIssuer`). An identifier containing `#`
 * is a WebID by construction, so it is not probed.
 *
 * Solid decouples identity from storage on purpose, which is why this file
 * never derives one from the other — see `getPrimaryPodUrl` in `pod.ts` for the
 * storage half.
 */
import { Session } from "@inrupt/solid-client-authn-browser";
import { getSolidDataset, getThing, getUrl } from "@inrupt/solid-client";
import { APP_NAME, SESSION_ID } from "../config";

const OIDC_ISSUER_PREDICATE = "http://www.w3.org/ns/solid/terms#oidcIssuer";

/**
 * One explicit Session rather than the library's default singleton: the second
 * constructor argument is the storage key, and an app that does not set it
 * shares storage with every other app on the same origin.
 */
const session = new Session({}, SESSION_ID);

/** Result of `completeLogin`. `offline` means the check itself failed. */
export interface LoginState {
  loggedIn: boolean;
  webId: string | null;
  /**
   * True when the session could not be checked at all — no network, blocked
   * third-party storage, a sandboxed preview. Distinct from a clean logged-out
   * state, so an app can offer a demo mode instead of showing a login form that
   * cannot possibly work.
   */
  offline?: boolean;
  error?: string;
}

/** Reads `solid:oidcIssuer` from a WebID's own profile document. */
export async function discoverOidcIssuer(webId: string): Promise<string> {
  const profileUrl = webId.split("#")[0];

  let dataset;
  try {
    dataset = await getSolidDataset(profileUrl);
  } catch (err) {
    // A network-level failure here reaches the user as "Failed to fetch",
    // which tells them nothing about what to do. Name the address instead —
    // by far the most common causes are a typo and a provider that is down.
    throw new Error(
      `Could not reach ${profileUrl}. Check the address, and that the ` +
        `provider is online. (${err instanceof Error ? err.message : String(err)})`
    );
  }

  const me = getThing(dataset, webId);
  if (!me) {
    throw new Error(
      `${profileUrl} responded, but does not describe ${webId}. ` +
        `If this is a pod address rather than a WebID, it may not be a Solid provider.`
    );
  }
  const issuer = getUrl(me, OIDC_ISSUER_PREDICATE);
  if (!issuer) {
    throw new Error(
      `The profile at ${profileUrl} declares no solid:oidcIssuer, so there is ` +
        `no provider to sign in with. Try entering the pod's address instead.`
    );
  }
  return issuer;
}

/** True if the URL exposes an OpenID Connect configuration — i.e. is a provider. */
async function isOidcIssuer(url: string): Promise<boolean> {
  try {
    const res = await fetch(new URL(".well-known/openid-configuration", url).toString());
    return res.ok;
  } catch {
    return false;
  }
}

/** Resolves an issuer URL or a WebID to the OIDC issuer to redirect to. */
export async function resolveOidcIssuer(identifier: string): Promise<string> {
  if (!identifier.includes("#") && (await isOidcIssuer(identifier))) {
    return identifier;
  }
  return discoverOidcIssuer(identifier);
}

/**
 * Redirects to the provider. `redirectUrl` is derived from the current location
 * rather than configured, so the app self-registers wherever it is served
 * (Dynamic Client Registration) — localhost and production need no separate
 * setup. The query string is stripped so a second login does not stack
 * redirect parameters, and the fragment because OIDC refuses a redirect URL
 * that has one (an app with hash routes would otherwise never sign in).
 */
export async function loginWithIdentifier(identifier: string): Promise<void> {
  const oidcIssuer = await resolveOidcIssuer(identifier);
  await session.login({
    oidcIssuer,
    redirectUrl: redirectUrlFrom(window.location.href),
    clientName: APP_NAME,
  });
}

/** The current address without query string or fragment. */
export function redirectUrlFrom(href: string): string {
  const url = new URL(href);
  url.search = "";
  url.hash = "";
  return url.toString();
}

/**
 * Call once on startup: processes a return-from-provider redirect if there is
 * one, and otherwise restores a previous session.
 *
 * Never throws. A failure here means the session state is unknown, not that the
 * user is logged out, and an app that treats the two the same shows a login
 * form in situations where login cannot work at all.
 */
export async function completeLogin(): Promise<LoginState> {
  try {
    const info = await session.handleIncomingRedirect({ restorePreviousSession: true });
    if (info?.isLoggedIn && info.webId) {
      return { loggedIn: true, webId: info.webId };
    }
    return { loggedIn: false, webId: null };
  } catch (err) {
    return {
      loggedIn: false,
      webId: null,
      offline: true,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function getSession(): Session {
  return session;
}

export async function logout(): Promise<void> {
  await session.logout();
}

/**
 * The authenticated fetch, for `pod.ts` and for any raw request an app makes.
 *
 * Delegates at call time rather than capturing `session.fetch` at module load:
 * the bound fetch changes when the session logs in, and a captured reference
 * would keep sending unauthenticated requests forever.
 */
export const authFetch: typeof globalThis.fetch = (input, init) =>
  session.fetch(input as RequestInfo, init);
