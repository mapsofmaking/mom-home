/**
 * The shell: login → pod discovery → the home app.
 *
 * No framework, no router. Screens are functions that replace the contents of
 * `#app`. Kit shell (solid-kit f880797): signed out the page onboards,
 * signed in it is the workbench (src/workbench/page.ts); the kit's sign-in
 * and error screens stay.
 */
// The design system first (pinned copy, README.md), so the kit's rules after
// it win on the kit's own screens (the skin colours them); the Workbench
// classes (wb-, hx-) don't collide with the kit's.
import "./styles/mom/tokens.css";
import "./styles/mom/components.css";
import "./styles/mom/workbench.css";
import "./styles/fonts.css";
import "./styles/core.css";
import "./styles/theme.css";
import "./styles/patterns.css";
import "./styles/editorial.css";
import "./styles/home.css";
import { completeLogin, loginWithIdentifier, logout } from "./lib/auth";
import { describePodError, getPrimaryPodUrl, isAuthError } from "./lib/pod";
import { APP_NAME, DEFAULT_IDENTIFIER } from "./config";
import { focusView, trackInputModality } from "./ui/a11y";
import { renderError, renderPending } from "./ui/patterns";
import { loadTree } from "./tree/load";
import { renderPage, type FoldState } from "./workbench/page";
import { displayName } from "./workbench/who";
import { changeHomeSettings, readHomeSettings, type HomeSettings } from "./settings/home";
import { readDone } from "./tiles/done";
import { announce } from "./ui/a11y";
import type { Draft } from "./workbench/previews";
import type { Tree } from "./tree/parse";

const app = document.querySelector<HTMLDivElement>("#app")!;

/** Escapes text before it goes into innerHTML — WebIDs and errors are inputs. */
function esc(value: string): string {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
}

/**
 * One header row on every screen (Story 14.1 AC1b): the map's wordmark, then
 * the app's name. Signed-in state and sign-out sit on its right.
 */
function appHeader(right = ""): string {
  return `
    <header class="topbar app-head">
      <a class="app-mark" href="https://mapsofmaking.org/">maps of making</a>
      <span class="app-name">home</span>
      <span class="app-head-right">${right}</span>
    </header>`;
}

/** The tile tree, read once at load. The hex view and the workbench draw from it (S3). */
let tree: Tree | null = null;
export const currentTree = (): Tree | null => tree;

/**
 * Signed out, what is done and what was typed live in memory (AC4). In dev,
 * `?done=describe,keep` starts further along, to review the fog by eye.
 */
const done = new Set<string>(
  import.meta.env.DEV ? (new URLSearchParams(location.search).get("done") ?? "").split(",").filter(Boolean) : []
);
const draft: Draft = {};
/** The hex panel's fold, one state for the page (page.ts). Signed in, S6 keeps it in settings/home.ttl. */
const fold: FoldState = { folded: null };

/** Signed in: the pod's root, for the done checks (S6). */
let podRoot: string | null = null;
export const currentPod = (): string | null => podRoot;

function renderOnboardingView(): void {
  renderPage(app, tree!, { mode: "onboarding", done, draft, fold, onSignIn: () => renderLoginView(), onSignOut: signOut });
  focusView(app);
}

/**
 * Signed in through the pod, the same page is the workbench (AC1b). What is
 * done is read from the pod (src/tiles/done.ts), never carried over from the
 * signed-out tab; the fold comes from settings/home.ttl and goes back there.
 * Without a pod (the dev preview) both stay in the tab.
 */
function renderWorkbenchView(
  name: string,
  pod: { webId: string; root: string; done: Set<string>; settings: HomeSettings } | null = null
): void {
  const wbFold: FoldState = pod ? { folded: pod.settings.folded } : fold;
  renderPage(app, tree!, {
    mode: "workbench",
    who: name,
    // Dev: `?done=` applies here too, to review the toolbar further along.
    done: pod ? pod.done : import.meta.env.DEV ? new Set(done) : new Set(),
    draft: {},
    fold: wbFold,
    onFold: pod
      ? (folded) => {
          changeHomeSettings(pod.root, pod.webId, (s) => ({ ...s, folded })).catch((err) => {
            console.warn("Could not keep the fold in settings/home.ttl:", err);
            announce("Your pod didn't take that change. It holds for this visit.");
          });
        }
      : undefined,
    onSignIn: () => renderLoginView(),
    onSignOut: signOut,
  });
  focusView(app);
}

async function signOut(): Promise<void> {
  await logout();
  podRoot = null;
  renderOnboardingView();
}

async function main(): Promise<void> {
  try {
    tree = await loadTree();
  } catch (err) {
    renderTreeErrorView(err);
    return;
  }

  // Dev only: `?workbench=<name>` draws the signed-in page without a session,
  // to review the workbench by eye. Production ignores it.
  const devWorkbench = import.meta.env.DEV ? new URLSearchParams(location.search).get("workbench") : null;
  if (devWorkbench) {
    renderWorkbenchView(devWorkbench);
    return;
  }

  const state = await completeLogin();

  if (!state.loggedIn) {
    // Signed out, the page is onboarding (AC1b); a failed restore still says why.
    if (state.offline) {
      renderLoginView(
        "Could not reach the identity layer from here — check the connection, or try again from the app's own address."
      );
    } else {
      renderOnboardingView();
    }
    return;
  }

  const webId = state.webId!;
  renderLoadingView(webId);

  try {
    podRoot = await getPrimaryPodUrl(webId);
    const root = podRoot;
    // Settings that can't be read cost the remembered fold, not the page.
    const [name, doneOnPod, settings] = await Promise.all([
      displayName(webId),
      readDone(tree!, { webId, podRoot: root }),
      readHomeSettings(root).catch((err): HomeSettings => {
        console.warn("Could not read settings/home.ttl:", err);
        return { folded: null, seen: [] };
      }),
    ]);
    renderWorkbenchView(name, { webId, root, done: doneOnPod, settings });
  } catch (err) {
    renderErrorView(webId, err);
  }
}

function renderLoginView(message?: string): void {
  app.innerHTML = `
    <main class="screen stack">
      ${appHeader()}
      <h1>${esc(APP_NAME)}</h1>
      <p class="lead">
        Sign in with your pod's address, or with your WebID if you don't know
        which provider hosts it — it will be discovered from your profile.
      </p>
      <form id="login-form" class="stack">
        <div class="field">
          <label for="identifier">Pod or WebID</label>
          <input id="identifier" name="identifier" type="url"
                 value="${esc(DEFAULT_IDENTIFIER)}" required />
        </div>
        <div><button type="submit">Sign in</button></div>
      </form>
      ${message ? `<p class="error">${esc(message)}</p>` : ""}
      <p><button type="button" class="ghost" id="not-yet">Not on the map yet? Start here</button></p>
    </main>
  `;
  document.querySelector("#not-yet")!.addEventListener("click", () => renderOnboardingView());

  const form = document.querySelector<HTMLFormElement>("#login-form")!;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = document.querySelector<HTMLInputElement>("#identifier")!;
    const button = form.querySelector("button")!;
    button.disabled = true;
    button.textContent = "Redirecting…";
    try {
      await loginWithIdentifier(input.value.trim());
    } catch (err) {
      renderLoginView(err instanceof Error ? err.message : String(err));
    }
  });

  focusView(app);
}

function renderLoadingView(webId: string): void {
  app.innerHTML = `
    <main class="screen stack">
      <h1 class="visually-hidden" data-view-title>Connecting</h1>
      <p class="lead">Signed in as <code>${esc(webId)}</code>.</p>
      ${renderPending("Looking for your pod…")}
    </main>
  `;
  focusView(app);
}

/**
 * Pod discovery failed — which, on a pod app, is a routine outcome rather than
 * an exceptional one, and never the user's mistake.
 *
 * Rendered by `renderError` rather than by hand so it cannot become a dead end:
 * the component refuses an error state that offers no way forward. An expired
 * session is the common case here and it has a real answer — sign in again —
 * so the copy says that rather than leaving someone staring at a status code.
 */
function renderErrorView(webId: string, err: unknown): void {
  app.innerHTML = `
    <main class="screen stack">
      ${renderError({
        title: isAuthError(err) ? "Your session ended" : "Could not reach your pod",
        detail: describePodError(err),
        recovery: isAuthError(err)
          ? "Nothing was lost — your work is in the pod, not in this tab. Signing in again brings it back."
          : "Your pod is unaffected. This is about reaching it from here, not about what is in it.",
        action: { label: "Sign in again", id: "logout" },
        technical: err instanceof Error ? err.message : String(err),
      })}
      <p class="meta">Signed in as <code>${esc(webId)}</code>.</p>
    </main>
  `;
  document.querySelector<HTMLButtonElement>("#logout")!.addEventListener("click", async () => {
    await logout();
    renderLoginView();
  });

  focusView(app);
}

/**
 * The tree didn't load or didn't parse (AC2): never a blank map. Nothing the
 * coordinator typed is at stake yet; the tree is ours, so the copy says so.
 */
function renderTreeErrorView(err: unknown): void {
  app.innerHTML = `
    <main class="screen stack">
      ${appHeader()}
      ${renderError({
        title: "This page didn't load properly",
        detail: "The list of what you can do here didn't come through. That's on our side, not yours.",
        recovery: "Nothing you typed is lost. Try again in a minute; if it keeps happening, the map at mapsofmaking.org still works.",
        action: { label: "Try again", id: "retry" },
        technical: err instanceof Error ? err.message : String(err),
      })}
    </main>
  `;
  document.querySelector<HTMLButtonElement>("#retry")!.addEventListener("click", () => {
    void main();
  });
  focusView(app);
}

trackInputModality();
main();
