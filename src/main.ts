/**
 * The shell: login → pod discovery → the home app.
 *
 * No framework, no router. Screens are functions that replace the contents of
 * `#app`. Kit shell (solid-kit f880797) with the app's header row; the hex
 * view and the workbench replace `renderHome` and the signed-out screen in
 * Story 14.1's next slices.
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
import { completeLogin, getSession, loginWithIdentifier, logout } from "./lib/auth";
import { describePodError, getPrimaryPodUrl, isAuthError } from "./lib/pod";
import { APP_NAME, DEFAULT_IDENTIFIER } from "./config";
import { focusView, trackInputModality } from "./ui/a11y";
import { renderError, renderPending } from "./ui/patterns";

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

async function main(): Promise<void> {
  const state = await completeLogin();

  if (!state.loggedIn) {
    renderLoginView(
      state.offline
        ? "Could not reach the identity layer from here — check the connection, or try again from the app's own address."
        : undefined
    );
    return;
  }

  const webId = state.webId!;
  renderLoadingView(webId);

  try {
    const podUrl = await getPrimaryPodUrl(webId);
    await renderHome(webId, podUrl);
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
    </main>
  `;

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
 * Replace this. It exists to prove the chain end to end — session, WebID, pod
 * root — so a new app starts from something known to work rather than from a
 * blank file.
 *
 * The links to the kit's reference pages live HERE, in the placeholder, rather
 * than in the shell above: replacing this function is what removes them. An app
 * built from the kit gets no stray links pointing at pages its users have no
 * business seeing, and nothing has to be remembered or configured off.
 * Both reference pages still ship in `dist/` — /styleguide.html and
 * /guidelines.html — they just stop being linked from the app.
 */
async function renderHome(webId: string, podUrl: string): Promise<void> {
  app.innerHTML = `
    <main class="screen stack">
      ${appHeader(`<button id="logout" class="ghost">Sign out</button>`)}
      <h1>Connected</h1>
      <p class="lead">This is where the app goes.</p>
      <dl class="stack">
        <div>
          <dt class="label-mono">WebID</dt>
          <dd><code>${esc(webId)}</code></dd>
        </div>
        <div>
          <dt class="label-mono">Pod root</dt>
          <dd><code>${esc(podUrl)}</code></dd>
        </div>
      </dl>
      <p class="hint">
        Session id <code>${esc(getSession().info.sessionId)}</code> — must be
        unique per app, see src/config.ts.
      </p>

      <hr />

      <nav class="stack">
        <p class="label-mono">Kit reference</p>
        <p>
          <a href="/styleguide.html">Design system</a>
          <span class="hint">
            — tokens, type scale and components, with live contrast ratios.
          </span>
        </p>
        <p>
          <a href="/guidelines.html">UX guidelines</a>
          <span class="hint">
            — the interaction patterns, running, and how their limits are set.
          </span>
        </p>
        <p class="hint">This block goes when you replace <code>renderHome</code>.</p>
      </nav>
    </main>
  `;
  document.querySelector<HTMLButtonElement>("#logout")!.addEventListener("click", async () => {
    await logout();
    renderLoginView();
  });

  focusView(app);
}

trackInputModality();
main();
