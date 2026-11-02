/**
 * Creating an account and a pod through the Community Solid Server account API
 * (`/.account/`), from a same-site app (solid-kit ADR 010, amendment points 8-11).
 *
 * COPIED from solid-backoffice `src/lib/css-account.ts` at `c9243b3` (kit ADR
 * 004: copied, not packaged), itself the TypeScript port of pocpod0's
 * `registerAccount`. Meant to move into solid-kit as `lib/register.ts`, so it
 * stays domain-free: no tile, no tree, no draft, no words shown to anyone. The
 * caller turns an `AccountError.code` into its own message.
 *
 * Differences from the backoffice copy, each for Maps of Making home (Story 14.3):
 * - After the pod, it LOGS IN through the account API (`controls.password.login`,
 *   `credentials: "include"`). That login, not the creation, sets the
 *   provider's `css-account` cookie, which spares the person the provider's
 *   login page at sign-in (14.0: flow A instead of B). Best effort: an account
 *   whose login step failed is still a working account (flow B).
 * - The pod name follows the server's own guard (solid-css-overlay
 *   PodNameGuard: a DNS label up to 63 characters), not the backoffice's 2-40.
 * - A request that never reaches the server is `unreachable`, a 429 from the
 *   gateway's rate limit is `rate-limited` (the backoffice let both escape as
 *   raw errors).
 * - A name the server refuses as reserved reads as taken: either way, the person
 *   picks another one.
 *
 * Kept from the backoffice copy, on purpose:
 * - Account, then password login, then pod. If the pod step fails (the name is
 *   taken), the account already has a login, and the retry picks another name
 *   on the SAME account: `account.create` is not idempotent, and an account
 *   cannot be deleted (CSS 7.2), so a second one would be an orphan forever.
 * - That half-built account is remembered for the life of the page (module
 *   state), not per pod name, and never in storage.
 * - An empty pod name never reaches the network: CSS reads it as "claim the
 *   server root".
 * - The passphrase is sent once, to the password step (and to the login step
 *   right after), and is never kept: once the provider holds a login, a retry
 *   does not need it again.
 *
 * Plain `fetch`, never `authFetch`: nobody is signed in yet.
 */
import { podNameProblem } from "./podname";

export type AccountErrorCode =
  | "bad-name"
  | "name-taken"
  | "bad-email"
  | "email-taken"
  | "bad-password"
  | "unreachable"
  | "rate-limited"
  | "provider";

export class AccountError extends Error {
  readonly code: AccountErrorCode;
  /** True when nothing exists on the provider yet because of this attempt. */
  readonly nothingCreated: boolean;
  constructor(code: AccountErrorCode, message: string, nothingCreated = false) {
    super(message);
    this.name = "AccountError";
    this.code = code;
    this.nothingCreated = nothingCreated;
  }
}

export interface SignUp {
  /** The pod's name: `<name>.<server host>`. */
  name: string;
  email: string;
  password: string;
}

export interface NewAccount {
  webId: string;
  pod: string;
  /** The email the account signs in with: the first one the provider accepted. */
  email: string;
  /** The account-API login set the provider's cookie (flow A); false: the provider's login page will ask (flow B). */
  loggedIn: boolean;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MIN_PASSWORD = 8;

/** One registration in progress, so a retry resumes it instead of starting over. */
interface Pending {
  issuer: string;
  token: string;
  /** Set once the provider accepted a password login: the email it holds. */
  email: string | null;
}
let pending: Pending | null = null;

/** Forget a registration in progress. Tests, and nothing else. */
export function resetPendingSignUp(): void {
  pending = null;
}

/** The email the half-built account already holds, if any: a retry cannot change it. */
export function pendingEmail(issuer: string): string | null {
  return pending && pending.issuer === issuer ? pending.email : null;
}

async function problem(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  try {
    const body = JSON.parse(text);
    if (typeof body?.message === "string") return body.message;
  } catch {
    /* not JSON: use the text */
  }
  return text.slice(0, 200) || `status ${res.status}`;
}

/**
 * Account → password login → pod → login, in that order. Throws an
 * `AccountError`; never a raw network error.
 */
export async function createAccount(
  issuer: string,
  input: SignUp,
  fetchImpl: typeof fetch = (...args) => fetch(...args)
): Promise<NewAccount> {
  const name = input.name.trim();
  const email = input.email.trim();
  const fresh = !pending || pending.issuer !== issuer;
  const held = fresh ? null : pending!.email;
  // Once the provider holds a login, a retry only changes the name.
  const checks: [AccountErrorCode, boolean][] = [
    ["bad-name", podNameProblem(name) !== null],
    ["bad-email", !held && !EMAIL.test(email)],
    ["bad-password", !held && (input.password.length < MIN_PASSWORD || /\s/.test(input.password))],
  ];
  const invalid = checks.find(([, bad]) => bad);
  if (invalid) throw new AccountError(invalid[0], `Refused before sending: ${invalid[0]}.`, fresh);

  // Every request goes through here: no answer at all, or the gateway's limit, is said as such.
  const call = async (url: string, init: RequestInit | undefined, nothingCreated: boolean): Promise<Response> => {
    let res: Response;
    try {
      res = await fetchImpl(url, init);
    } catch (err) {
      throw new AccountError("unreachable", `The pod server did not answer: ${(err as Error).message}`, nothingCreated);
    }
    if (res.status === 429) throw new AccountError("rate-limited", "Too many attempts from this address.", nothingCreated);
    return res;
  };

  const accountIndex = new URL(".account/", issuer).href;
  const fail = async (res: Response, what: string, nothingCreated: boolean) =>
    new AccountError("provider", `${what}: ${await problem(res)}`, nothingCreated);

  if (fresh) {
    const index = await call(accountIndex, undefined, true);
    if (!index.ok) throw await fail(index, "The provider's account service did not answer", true);
    const createUrl = (await index.json())?.controls?.account?.create;
    if (!createUrl) throw new AccountError("provider", "The provider does not offer account creation.", true);
    const created = await call(createUrl, { method: "POST", credentials: "include" }, true);
    if (!created.ok) throw await fail(created, "Could not create the account", true);
    const { authorization } = await created.json();
    if (!authorization) throw new AccountError("provider", "The provider created no account session.", true);
    pending = { issuer, token: authorization, email: null };
  }
  const state = pending!;
  const token = { Authorization: `CSS-Account-Token ${state.token}` };
  const json = { ...token, "Content-Type": "application/json" };

  // A GET with a JSON content type and no body makes CSS 7 answer 500.
  const controlsRes = await call(accountIndex, { headers: token }, false);
  if (!controlsRes.ok) throw await fail(controlsRes, "Could not open the new account", false);
  const controls = (await controlsRes.json())?.controls;
  if (!controls?.password?.create || !controls?.account?.pod) {
    throw new AccountError("provider", "The provider's account service is missing a step.");
  }

  if (!state.email) {
    const res = await call(
      controls.password.create,
      { method: "POST", headers: json, body: JSON.stringify({ email, password: input.password }) },
      false
    );
    if (!res.ok) {
      const message = await problem(res);
      throw /already|exist/i.test(message)
        ? new AccountError("email-taken", message)
        : new AccountError("provider", `Could not set the passphrase: ${message}`);
    }
    state.email = email;
  }

  const res = await call(
    controls.account.pod,
    { method: "POST", headers: json, body: JSON.stringify({ name }) },
    false
  );
  if (!res.ok) {
    const message = await problem(res);
    throw /already|exist|reserved/i.test(message)
      ? new AccountError("name-taken", message)
      : /pod name|characters|subdomain|label/i.test(message)
        ? new AccountError("bad-name", message)
        : new AccountError("provider", `Could not create the pod: ${message}`);
  }
  const { pod, webId } = await res.json();
  if (!pod || !webId) throw new AccountError("provider", "The provider created the pod but did not say where.");
  const madeWith = state.email;
  pending = null;

  // The login sets the provider's cookie (14.0); a failure here costs a login page later, nothing more.
  let loggedIn = false;
  try {
    const loginUrl = controls?.password?.login ?? new URL(".account/login/password/", issuer).href;
    const login = await fetchImpl(loginUrl, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: madeWith, password: input.password, remember: true }),
    });
    loggedIn = login.ok;
  } catch {
    /* flow B: the provider's login page asks for the passphrase */
  }
  return { webId, pod, email: madeWith, loggedIn };
}
