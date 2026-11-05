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
import { announce, focusView, trackInputModality } from "./ui/a11y";
import { renderError, renderPending } from "./ui/patterns";
import { loadTree } from "./tree/load";
import { saveLogoAddress, uploadLogo } from "./lib/logo";
import { renderPage, type FoldState, type PageHandle } from "./workbench/page";
import { displayName } from "./workbench/who";
import { changeHomeSettings, ensureSettingsReadme, readHomeSettings, type HomeSettings } from "./settings/home";
import { forgetReads } from "./lib/read";
import { readDone } from "./tiles/done";
import { makeDraftStore } from "./lib/draft";
import { hasForwarded, readForwarded } from "./lib/forwarded";
import { clearPodMade, peekPodMade, takePodMade, type PodMade } from "./lib/handoff";
import { putOnMap, readPublished, type OnMap, rereadOnMap } from "./lib/onmap";
import { saveHours } from "./lib/hours";
import { moveSpace } from "./lib/move";
import { loadProfile, saveProfile } from "./lib/profile";
import { makeSpacePublic, PublishError, readSpaceAt, readSpaceFile, spaceFileUrl, spaceIsPublic, writeSpaceFile } from "./lib/publish";
import { registerSpace, spacesInPublicIndex } from "./lib/typeindex";
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
/**
 * What was typed signed out, kept in this browser (14.2 AC7) for 30 days: a
 * coordinator who comes back next week finds the form as they left it. Not
 * genjson's `genjson_draft`: that one lives on the map's origin.
 */
const DRAFT_DAYS = 30;
const drafts = makeDraftStore<Draft>("mom-home:draft", DRAFT_DAYS * 24 * 60 * 60 * 1000);
const DRAFT_ID = "space";
/** A stored draft is read as text fields only: an older or damaged entry costs the draft, never the page. */
function loadDraft(): Draft {
  const raw: unknown = drafts.load(DRAFT_ID);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) if (typeof v === "string") out[k] = v;
  return out as Draft;
}
const draft: Draft = loadDraft();
const keepDraft = (d: Draft) => (Object.keys(d).length ? drafts.save(DRAFT_ID, d) : drafts.clear(DRAFT_ID));
/**
 * A draft forwarded from the old genjson wizard (14.8 AC2) arrives in the
 * fragment. It is taken once, and only when this browser has no draft of its
 * own: what was typed here is newer. The fragment leaves the address either way.
 */
function takeForwarded(): void {
  if (!hasForwarded(location.hash)) return;
  const forwarded = readForwarded(location.hash);
  if (forwarded && !Object.keys(draft).length) {
    Object.assign(draft, forwarded);
    keepDraft(draft);
  }
  history.replaceState(null, "", location.pathname + location.search);
}
takeForwarded();
/** The hex panel's fold, one state for the page (page.ts). Signed in, S6 keeps it in settings/mom-home.ttl. */
const fold: FoldState = { folded: null };

/** Signed in: the pod's root, for the done checks (S6). */
let podRoot: string | null = null;
export const currentPod = (): string | null => podRoot;

/** The page now drawn: undone before another is drawn into #app, so listeners and observers never stack. */
let page: PageHandle | null = null;
function show(options: Parameters<typeof renderPage>[2]): void {
  page?.destroy();
  page = renderPage(app, tree!, options);
}

function renderOnboardingView(): void {
  show({
    mode: "onboarding",
    done,
    draft,
    onDraft: keepDraft,
    fold,
    onSignIn: () => renderLoginView(),
    onSignOut: signOut,
    // Tile B, after creating the pod (14.3 AC6): straight to the pod server's own page.
    signIn: () => loginWithIdentifier(DEFAULT_IDENTIFIER),
    // A pod this tab made and did not sign in to (the provider's page was abandoned): sign in to it, don't make a second.
    priorPod: peekPodMade(),
  });
  focusView(app);
}

/**
 * Signed in through the pod, the same page is the workbench (AC1b). What is
 * done is read from the pod (src/tiles/done.ts), never carried over from the
 * signed-out tab; the fold comes from settings/mom-home.ttl and goes back there.
 * Without a pod (the dev preview) both stay in the tab.
 */
let writes: Promise<void> = Promise.resolve();

/**
 * The space, findable by type (#14): listed in the pod's public Type Index. Never in the coordinator's way:
 * sign-in finds the space without it (the pod root), and the next sign-in tries again, so a failure is said
 * in the console only.
 */
function listSpace(webId: string, podRoot: string, fileUrl: string): void {
  void registerSpace(webId, podRoot, fileUrl.split("#")[0] + "#space")
    .then(() => keepReadme(podRoot))
    .catch((err) => console.warn("The space is on the map but not in the public Type Index; the next sign-in tries again:", err));
}

/** settings/README.md says what home keeps on the pod (#48): brought up to date after home writes there, and at sign-in. */
function keepReadme(podRoot: string): Promise<void> {
  return ensureSettingsReadme(podRoot).catch((err) => console.warn("Could not bring the settings README up to date:", err));
}

function renderWorkbenchView(
  name: string,
  pod: { webId: string; root: string; done: Set<string>; settings: HomeSettings; published?: { fileUrl: string; onMap: OnMap } | null; onPod?: { fileUrl: string; open: boolean } | null; spaceText?: string | null } | null = null,
  podReady: PodMade | null = null
): void {
  const wbFold: FoldState = pod ? { folded: pod.settings.folded } : fold;
  show({
    mode: "workbench",
    who: name,
    // Dev: `?done=` applies here too, to review the toolbar further along.
    done: pod ? pod.done : import.meta.env.DEV ? new Set(done) : new Set(),
    // The description typed signed out stays in this browser until 14.4 writes it to the pod: it is not lost at sign-in.
    draft,
    fold: wbFold,
    podReady,
    // Signed in with a pod: tile B puts the space on the map (Story 14.4). Without a pod (the dev preview) there is nothing to write to.
    publishSpace: pod
      ? async (d) => {
          const result = await writeSpaceFile(pod.root, d);
          // Decision 2 (14.4): written and read back, the pod holds it; the browser's copy goes.
          drafts.clear(DRAFT_ID);
          return result;
        }
      : undefined,
    makePublic: pod ? () => makeSpacePublic(spaceFileUrl(pod.root), pod.webId) : undefined,
    putOnMap: pod
      ? async (fileUrl) => {
          const onMap = await putOnMap(fileUrl);
          // The Type Index goes last (story Dev Notes): the pod says "published" once the map has it.
          listSpace(pod.webId, pod.root, fileUrl);
          return onMap;
        }
      : undefined,
    // Tile C (14.6 S1, #36): the hours, changed in home's own space file at the pod root.
    saveHours: pod ? (hours) => saveHours(spaceFileUrl(pod.root), hours) : undefined,
    // Then the map reads it now (S2, #37): registered again, the card read back until it says the new hours.
    mapRead: pod ? (says) => rereadOnMap(spaceFileUrl(pod.root), says) : undefined,
    // Tile C's logo (S6, #41): uploaded next to the space file, or an address already online.
    uploadLogo: pod ? (file, current) => uploadLogo(pod.root, pod.webId, file, current) : undefined,
    useLogoAddress: pod ? (typed) => saveLogoAddress(pod.root, typed) : undefined,
    moveSpace: pod ? (next) => moveSpace(spaceFileUrl(pod.root), next) : undefined,
    // Tile C on a later visit (S4, #39): the whole profile, read from the space file and saved to it in one patch.
    profileTool: pod ? { load: () => loadProfile(spaceFileUrl(pod.root), tree!.profile), save: (edit) => saveProfile(spaceFileUrl(pod.root), tree!.profile, edit) } : undefined,
    // The file as the pod held it at sign-in: tile C shows it before the first change (C1).
    spaceText: pod?.spaceText ?? null,
    // Already on the map at sign-in: tile B shows the threshold, read from the pod and the map.
    published: pod?.published ?? null,
    // On the pod, not on the map yet: the steps start from what is there (S5, #15).
    onPod: pod?.onPod ?? null,
    onFold: pod
      ? (folded) => {
          // One write at a time, in the order of the clicks: the pod ends on the last toggle.
          writes = writes
            .then(() => changeHomeSettings(pod.root, pod.webId, (s) => ({ ...s, folded })))
            .catch((err) => {
              console.warn("Could not keep the fold in settings/mom-home.ttl:", err);
              announce(
                err?.name === "SettingsUnreadable"
                  ? "Your settings file on the pod can't be read, so it was left alone. The fold holds for this visit."
                  : "Your pod didn't take that change. It holds for this visit."
              );
            });
        }
      : undefined,
    onSignIn: () => renderLoginView(),
    onSignOut: signOut,
  });
  focusView(app);
}

async function signOut(): Promise<void> {
  try {
    await logout();
  } catch (err) {
    console.warn("Sign-out did not complete at the provider:", err);
  } finally {
    // Whatever the provider said, this tab forgets the person: pod data must not outlive the session.
    podRoot = null;
    clearPodMade();
    forgetReads();
    done.clear();
    for (const k of Object.keys(draft)) delete (draft as Record<string, unknown>)[k];
    drafts.clear(DRAFT_ID);
    fold.folded = null;
    writes = Promise.resolve();
    renderOnboardingView();
  }
}

async function main(): Promise<void> {
  // The return from the provider first: its ?code=&state= are spent on the
  // first look, so a tree that fails to load must not lose them. A retry
  // then finds the session already restored.
  const state = await completeLogin().catch((err) => {
    console.warn("Sign-in could not be completed:", err);
    return null;
  });

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

  if (!state) {
    renderLoginView("Signing in did not complete. Try again.");
    return;
  }

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
    // The space, read back from the pod (#11): the pod is the source, so the form and the card are filled from it.
    // A session refused here is the error view's "sign in again"; a file that can't be read costs the card, not the page.
    // Where the space is: the pod's public Type Index first (#14), each entry in turn, then the pod root's
    // space.ttl: a stale entry never hides a space that is there.
    const listed = await spacesInPublicIndex(webId, root).catch(() => [] as string[]);
    const firstReadable = async () => {
      for (const at of listed) {
        const read = await readSpaceAt(at).catch((err) => {
          if (err instanceof PublishError && err.code === "expired") throw err;
          return null;
        });
        if (read) return read;
      }
      return readSpaceFile(root);
    };
    const found = await firstReadable().catch((err) => {
      if (err instanceof PublishError && err.code === "expired") throw err;
      console.warn("Could not read space.ttl:", err);
      return null;
    });
    if (found) {
      for (const k of Object.keys(draft)) delete (draft as Record<string, unknown>)[k];
      Object.assign(draft, found.draft);
    }
    // On the map is read too (#14): the map holds the file's address, and a stranger can read the file.
    // Readable by anyone, asked once: on the map needs it, and a space not on the map yet resumes from it (S5, #15).
    const readable = found ? await spaceIsPublic(found.url).catch(() => false) : false;
    const published = found ? await readPublished(found.url, async () => readable) : null;
    // Public and on the map but not in the index (a registration that failed before): list it now, quietly.
    if (found && published && !listed.includes(found.space)) listSpace(webId, root, found.url);
    // Home has written to this pod: its README section says what (#48). Quietly, and only if it changed.
    else if (found) void keepReadme(root);
    // Settings that can't be read cost the remembered fold, not the page.
    const [name, doneOnPod, settings] = await Promise.all([
      displayName(webId),
      readDone(tree!, { webId, podRoot: root, space: found?.space ?? null, spaceData: found?.draft ?? null, onMap: published !== null }),
      readHomeSettings(root).catch((err): HomeSettings => {
        console.warn("Could not read settings/mom-home.ttl:", err);
        return { folded: null, seen: [] };
      }),
    ]);
    // Just made in this tab (14.3 AC6): tile B says the pod is ready, once.
    // The one-shot "pod ready" panel is for an empty pod: once the space file is there, the pod speaks for itself.
    const made = takePodMade(webId);
    renderWorkbenchView(name, { webId, root, done: doneOnPod, settings, published: published && found ? { fileUrl: found.url, onMap: published } : null, onPod: found && !published && found.url === spaceFileUrl(root) ? { fileUrl: found.url, open: readable } : null, spaceText: found?.text ?? null }, found ? null : made);
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
  // The space-file read (#11) says "expired" in its own words; same answer as the kit's 401/403.
  const ended = isAuthError(err) || (err instanceof PublishError && err.code === "expired");
  app.innerHTML = `
    <main class="screen stack">
      ${renderError({
        title: ended ? "Your session ended" : "Could not reach your pod",
        detail: describePodError(err),
        recovery: ended
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
