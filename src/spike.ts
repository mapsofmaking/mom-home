/**
 * TEMPORARY: spike 14.0 (OD-2), removed after the run. What does a newcomer see
 * between "Create it" and the first write? Runs against the throwaway instance
 * pod-test.mapsofmaking.org only (CSS 7.2 cannot delete accounts:
 * nicolasdb/solid-css-overlay#17). Reached with `/?spike`; the sign-in returns
 * to `/` (the Client ID Document's only redirect), so a sessionStorage flag
 * brings it back here instead of the app.
 *
 * Two steps, two buttons, so a test can clear cookies between them:
 *   1. Create: account, password login, pod (pocpod0 registerAccount), then
 *      optionally a password login through the account API with
 *      credentials: "include", which is what sets the `css-account` cookie.
 *   2. Sign in: Solid-OIDC with the app's Client ID Document; back here, write
 *      spike.txt to the new pod.
 */
import { authFetch, clientIdFor, completeLogin, loginWithIdentifier, redirectUrlFrom } from "./lib/auth";

export const SPIKE_ISSUER = "https://pod-test.mapsofmaking.org/";
const FLAG = "mom-spike";
const LOG = "mom-spike-log";

interface Entry {
  t: number;
  step: string;
  detail: string;
}

const now = () => Date.now();
const readLog = (): Entry[] => {
  try {
    return JSON.parse(sessionStorage.getItem(LOG) ?? "[]");
  } catch {
    return [];
  }
};
const readState = (): Record<string, string> => {
  try {
    return JSON.parse(sessionStorage.getItem(FLAG) ?? "{}");
  } catch {
    return {};
  }
};
const saveState = (s: Record<string, string>) => sessionStorage.setItem(FLAG, JSON.stringify(s));

function log(step: string, detail = ""): void {
  const all = readLog();
  all.push({ t: now(), step, detail });
  sessionStorage.setItem(LOG, JSON.stringify(all));
  render();
}

/** The spike owns the page when asked for, or when coming back from its own sign-in. */
export function spikeRequested(): boolean {
  if (new URLSearchParams(location.search).has("spike")) {
    if (!sessionStorage.getItem(FLAG)) saveState({});
    return true;
  }
  return sessionStorage.getItem(FLAG) !== null;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

function render(): void {
  const app = document.querySelector<HTMLElement>("#app") ?? document.body;
  const s = readState();
  const entries = readLog();
  const t0 = entries[0]?.t ?? now();
  app.innerHTML = `
    <main class="wb-page" style="padding: 24px; max-width: 760px; margin: 0 auto; display: flex; flex-direction: column; gap: 16px;">
      <h1 style="margin: 0;">Spike 14.0, a test page</h1>
      <p style="margin: 0;">Creates a throwaway account on <code>${SPIKE_ISSUER}</code>, signs in, writes one file. Nothing here touches the real pod server.</p>
      <label class="wb-field">Pod name
        <input id="spike-name" class="mono" value="${esc(s.name ?? `spike-${Math.random().toString(36).slice(2, 7)}`)}">
      </label>
      <label><input type="checkbox" id="spike-cookie" ${s.cookie === "no" ? "" : "checked"}> Log in through the account API after creating (sets the <code>css-account</code> cookie)</label>
      <div style="display: flex; gap: 12px;">
        <button class="btn btn-primary" id="spike-create" type="button">1. Create</button>
        <button class="btn" id="spike-signin" type="button" ${s.email ? "" : "disabled"}>2. Sign in and write</button>
        <button class="inline-link" id="spike-reset" type="button">Start over</button>
      </div>
      ${s.email ? `<p class="mono" id="spike-creds">email ${esc(s.email)} · password ${esc(s.password)}</p>` : ""}
      <ol id="spike-log" class="mono" style="font-size: 13px; display: flex; flex-direction: column; gap: 4px;">
        ${entries.map((e) => `<li data-step="${esc(e.step)}">+${((e.t - t0) / 1000).toFixed(1)} s · <b>${esc(e.step)}</b> ${esc(e.detail)}</li>`).join("")}
      </ol>
    </main>`;
  app.querySelector("#spike-create")?.addEventListener("click", () => void create());
  app.querySelector("#spike-signin")?.addEventListener("click", () => void signIn());
  app.querySelector("#spike-reset")?.addEventListener("click", () => {
    sessionStorage.removeItem(LOG);
    saveState({});
    render();
  });
}

async function detail(res: Response): Promise<string> {
  try {
    const b = await res.clone().json();
    return `${res.status} ${b.message ?? b.name ?? ""}`.trim();
  } catch {
    return String(res.status);
  }
}

async function create(): Promise<void> {
  const name = (document.querySelector<HTMLInputElement>("#spike-name")?.value ?? "").trim();
  const withCookie = document.querySelector<HTMLInputElement>("#spike-cookie")?.checked ?? true;
  if (!/^[a-z0-9-]{3,40}$/.test(name)) return log("refused", "pod name: a-z, 0-9, dashes");
  const email = `${name}@example.org`;
  const password = `Spike-${Math.random().toString(36).slice(2, 10)}-Test`;
  saveState({ name, cookie: withCookie ? "yes" : "no" });
  log("create: start", name);
  try {
    const index = await (await fetch(new URL(".account/", SPIKE_ISSUER))).json();
    const res = await fetch(index.controls.account.create, { method: "POST" });
    if (!res.ok) return log("create: account refused", await detail(res));
    const { authorization } = await res.json();
    const auth = { authorization: `CSS-Account-Token ${authorization}` };
    const { controls } = await (await fetch(new URL(".account/", SPIKE_ISSUER), { headers: auth })).json();
    const pw = await fetch(controls.password.create, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!pw.ok) return log("create: password refused", await detail(pw));
    const pod = await fetch(controls.account.pod, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (!pod.ok) return log("create: pod refused", await detail(pod));
    const { webId, pod: podUrl } = await pod.json();
    saveState({ name, cookie: withCookie ? "yes" : "no", email, password, webId, pod: podUrl ?? "" });
    log("create: done", `${webId}`);

    if (withCookie) {
      const login = await fetch(index.controls.password.login, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password, remember: true }),
      });
      log("account login (credentials: include)", await detail(login));
    }
    await cookieCheck("after create");
  } catch (err) {
    log("create: failed", err instanceof Error ? err.message : String(err));
  }
}

/** The cookie is HttpOnly: ask the account API whether it knows us without a token. */
async function cookieCheck(when: string): Promise<void> {
  try {
    const res = await fetch(new URL(".account/", SPIKE_ISSUER), { credentials: "include" });
    const { controls } = await res.json();
    log(`cookie check ${when}`, controls?.account?.pod ? "css-account cookie present (account API knows us)" : "no cookie (account API answers as a stranger)");
  } catch (err) {
    log(`cookie check ${when}`, `failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function signIn(): Promise<void> {
  await cookieCheck("before sign-in");
  const clientId = await clientIdFor(redirectUrlFrom(location.href));
  log("sign-in: redirect", clientId ? `client id ${clientId}` : "no Client ID Document: dynamic registration");
  await loginWithIdentifier(SPIKE_ISSUER);
}

async function back(): Promise<void> {
  const state = await completeLogin();
  if (!state.loggedIn) return render();
  const s = readState();
  if (s.done) return render();
  saveState({ ...s, done: "yes" });
  log("sign-in: back in the app", state.webId ?? "");
  const pod = s.pod || (state.webId ?? "").replace(/profile\/card#me$/, "");
  const res = await authFetch(pod + "spike.txt", {
    method: "PUT",
    headers: { "content-type": "text/plain" },
    body: `spike 14.0, ${new Date().toISOString()}\n`,
  });
  log("write spike.txt", `${res.status} ${pod}spike.txt`);
}

export async function runSpike(): Promise<void> {
  document.title = "Spike 14.0";
  render();
  await back();
}
