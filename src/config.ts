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

/**
 * The backoffice a network's members are invited to (#69): Maps of Making's production one. The invitation is
 * `${BACKOFFICE_URL}/?collective=<config.ttl>` (lib/collective.ts `inviteLink`), and requests to join are
 * answered there. No trailing slash.
 */
export const BACKOFFICE_URL = "https://backoffice.mapsofmaking.org";

/**
 * This app's own address, for links sent to someone else (#74: a member's "claim your spot" link,
 * `?from=<their file>`). Not `location.origin`: a copy made on a dev server must still lead to home.
 */
export const HOME_URL = "https://home.mapsofmaking.org/";

/** The tile tree (Story 14.1 AC2): tiles, requirements, cues, words, every line Bernard speaks. */
export const TREE_URL = "/onboarding.ttl";
