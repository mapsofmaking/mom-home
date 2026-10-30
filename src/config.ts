/**
 * Everything an app built from this kit is expected to change.
 *
 * Keeping these here rather than scattered through the code is what makes the
 * rest of `src/lib/` copyable between apps without a diff.
 */

/** Shown on the provider's consent screen. Name the app, not the kit. */
export const APP_NAME = "Maps of Making home";

/**
 * Stable across reloads so `restorePreviousSession` can find the session again.
 *
 * It must be UNIQUE PER APP. Two apps served from the same origin with the same
 * id share Inrupt's session storage and clobber each other's tokens — the bug
 * that forced valisette and the backoffice onto separate subdomains. Distinct
 * ids plus distinct origins is belt and braces; distinct ids alone is the part
 * you control from here.
 */
export const SESSION_ID = "mom-home";

/**
 * Prefilled in the login field. Either an OIDC issuer URL or a WebID works —
 * `loginWithIdentifier` accepts both. The pod server most spaces will use.
 */
export const DEFAULT_IDENTIFIER = "https://pod.mapsofmaking.org/";

/** The tile tree (Story 14.1 AC2): tiles, requirements, cues, words, every line Bernard speaks. */
export const TREE_URL = "/onboarding.ttl";
