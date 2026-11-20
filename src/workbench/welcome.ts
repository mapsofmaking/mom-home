/**
 * "Welcome your members" (#69), a network's own tile: the network becomes a Solid collective, and the tile ends
 * on the invitation link. Accepting and refusing stay in the backoffice.
 *
 * The state is read from the pod every time the tile is mounted (lib/collective.ts `readCollective`), never
 * kept: not set up, a short form (the invitation's title, and what joining means, prefilled from the network's
 * file) and one button; a setup that stopped halfway, one button that carries on; done, the link, a Copy
 * button, and where requests arrive. A pod that can't be read, or a session that ended, says so and offers no
 * button that writes: only a 404 on `config.ttl` makes the form appear.
 *
 * One voice (Bernard's line), one form, no pop-up. The box is the page's: it outlives a redraw (tool.ts's
 * pattern), so what is typed stays. Its words are the tree's (`onb:uiWelcome*` on `:welcome`).
 */
import type { Tile } from "../tree/parse";
import { BACKOFFICE_URL } from "../config";
import type { CollectiveState } from "../lib/collective";
import { PublishError } from "../lib/publish";
import { bernard, esc } from "./html";
import { tileUi } from "./tilewords";

export const WELCOME_UI_KEYS = [
  "uiWelcomeLoading", "uiWelcomeSlogan", "uiWelcomeSloganPlaceholder", "uiWelcomeDescription", "uiWelcomeDescriptionHint",
  "uiWelcomeGo", "uiWelcomeWorking", "uiWelcomeUnfinished", "uiWelcomeFinish", "uiWelcomeLinkLabel", "uiWelcomeCopy",
  "uiWelcomeCopied", "uiWelcomeRequests", "uiWelcomeNeedsPod", "uiWelcomeNoName", "uiWelcomeExpired", "uiWelcomeNoAccess",
  "uiWelcomeBroken", "uiWelcomeConflict", "uiWelcomeRules", "uiWelcomeWider", "uiWelcomeNotPublic", "uiWelcomeUnreachable",
  "uiWelcomeRefused", "uiWelcomeUnconfirmed", "uiWelcomeRetry", "uiWelcomeNoRead", "uiWelcomeNotOurs", "uiWelcomeMissingRoster",
  "uiWelcomeMissingInbox", "uiWelcomeMissingPublic", "uiWelcomeRosterTaken", "uiWelcomeConfigTaken",
] as const;
export type WelcomeUiKey = (typeof WELCOME_UI_KEYS)[number];
export const welcomeWords = (tile: Pick<Tile, "ui"> | undefined) => tileUi<WelcomeUiKey>(tile, "the welcome tile");

/** What the invitation says: typed on the form, written into config.ttl. */
export interface WelcomeWords {
  slogan: string;
  description: string;
}

export interface WelcomeDeps {
  tile: Tile;
  /** The network's name and description, from its file: the placeholder and the prefill. */
  name: string;
  description: string;
  load: () => Promise<CollectiveState>;
  setUp: (words: WelcomeWords) => Promise<CollectiveState>;
  /** The pod says done (after a setup, or read so): the page marks the tile done in this tab. */
  onDone?: () => void;
}

export interface WelcomeHandle {
  /** A setup is writing: the page holds the tiles still. */
  busy(): boolean;
  destroy(): void;
}

type Status = "loading" | "form" | "unfinished" | "working" | "done" | "failed";

interface State {
  status: Status;
  slogan: string;
  description: string;
  /** Why the last read or setup failed, in the tree's words. */
  message: string;
  /** What a failure offers: read again, press the button again (the form is kept), or nothing (fix it elsewhere). */
  retry: "read" | "setup" | "none";
  /** Where a setup was started from: the form, or the "carry on" button. */
  from: "form" | "unfinished";
  link: string;
  copied: boolean;
}

/** A failure in the tree's words. `reading`: it came from reading the pod, not from writing to it. */
export function welcomeFailure(err: unknown, ui: ReturnType<typeof welcomeWords>, reading: boolean): { message: string; retry: State["retry"] } {
  const e = err instanceof PublishError ? err : new PublishError("refused", String(err));
  switch (e.code) {
    case "expired": return { message: ui("uiWelcomeExpired"), retry: "none" };
    // 403: this account may not; signing in again won't change it (unlike a 401).
    case "no-control": return { message: ui(reading ? "uiWelcomeNoRead" : "uiWelcomeNoAccess"), retry: "none" };
    case "taken": return { message: ui(/config\.ttl/.test(e.message) ? "uiWelcomeConfigTaken" : "uiWelcomeRosterTaken"), retry: "none" };
    case "incomplete": return { message: ui("uiWelcomeNoName"), retry: "none" };
    // A config.ttl that can't be used is the owner's to fix, never this page's to rewrite.
    case "unreadable":
      return reading || /config\.ttl/.test(e.message)
        ? { message: ui("uiWelcomeBroken", { why: e.message }), retry: "none" }
        : { message: ui("uiWelcomeRefused"), retry: "setup" };
    case "conflict": return { message: ui("uiWelcomeConflict"), retry: "setup" };
    case "rules-unknown":
    case "no-wac": return { message: ui("uiWelcomeRules"), retry: "none" };
    case "rules-wider": return { message: ui("uiWelcomeWider"), retry: "none" };
    case "not-public": return { message: ui("uiWelcomeNotPublic"), retry: "setup" };
    case "unreachable": return { message: ui("uiWelcomeUnreachable"), retry: reading ? "read" : "setup" };
    case "unconfirmed": return { message: ui("uiWelcomeUnconfirmed"), retry: "setup" };
    default: return { message: ui("uiWelcomeRefused"), retry: reading ? "read" : "setup" };
  }
}

/** The tile's body for a state: pure, so it is tested without a pod. */
export function renderWelcome(tile: Tile, s: State, name: string): string {
  const ui = welcomeWords(tile);
  const head = `<div class="wb-step-head"><h2 class="wb-step-title" tabindex="-1">${esc(tile.title)}</h2></div>`;
  const status = (text: string, error = false) =>
    `<p class="${error ? "hint is-error" : "wb-aside"}" id="welcome-status" role="status" tabindex="-1">${esc(text)}</p>`;
  if (s.status === "loading") return head + bernard(tile.lines.say) + status(ui("uiWelcomeLoading"));
  if (s.status === "done") {
    return `${head}${bernard(tile.lines.saidDone)}
      <p class="wf-label" id="welcome-link-label">${esc(ui("uiWelcomeLinkLabel"))}</p>
      <p class="wb-welcome-link"><a class="inline-link mono" id="welcome-link" href="${esc(s.link)}" target="_blank" rel="noopener" aria-labelledby="welcome-link-label welcome-link">${esc(s.link)}</a></p>
      <div class="wb-out">
        <button type="button" class="btn btn-primary wb-cta" id="welcome-copy" data-copy="${esc(s.link)}">${esc(ui("uiWelcomeCopy"))}</button>
        <span class="wb-aside" id="welcome-copied" role="status">${s.copied ? esc(ui("uiWelcomeCopied")) : ""}</span>
      </div>
      <p><a class="inline-link" id="welcome-backoffice" href="${esc(BACKOFFICE_URL)}" target="_blank" rel="noopener">${esc(ui("uiWelcomeRequests"))}</a></p>`;
  }
  const busy = s.status === "working";
  const failed = s.status === "failed";
  // A read that failed: no form, nothing to write from; only reading again, when that can help.
  if (failed && s.retry !== "setup") {
    return `${head}${bernard(tile.lines.say)}${status(s.message, true)}${
      s.retry === "read" ? `<div class="wb-out"><button type="button" class="btn" id="welcome-retry">${esc(ui("uiWelcomeRetry"))}</button></div>` : ""
    }`;
  }
  const line = busy ? ui("uiWelcomeWorking") : failed ? s.message : "";
  const button = (id: string, key: WelcomeUiKey, type = "button") =>
    `<button type="${type}" class="btn btn-primary wb-cta" id="${id}"${busy ? ' disabled aria-busy="true"' : ""}>${esc(ui(key))}</button>`;
  if (s.from === "unfinished" && (s.status === "unfinished" || busy || failed)) {
    return `${head}${bernard(tile.lines.say)}<p class="wb-aside">${esc(ui("uiWelcomeUnfinished"))}</p>
      ${status(line, failed)}<div class="wb-form-actions">${button("welcome-go", "uiWelcomeFinish")}</div>`;
  }
  const dis = busy ? " disabled" : "";
  return `${head}${bernard(tile.lines.say)}
    <form id="f-welcome" class="wb-form" novalidate>
      <label class="wb-field" for="f-welcome-slogan">${esc(ui("uiWelcomeSlogan"))}
        <input id="f-welcome-slogan" name="slogan" type="text" autocomplete="off" value="${esc(s.slogan)}"
          placeholder="${esc(ui("uiWelcomeSloganPlaceholder", { name }))}"${dis} />
      </label>
      <label class="wb-field" for="f-welcome-description">${esc(ui("uiWelcomeDescription"))}
        <textarea id="f-welcome-description" name="description" rows="3" aria-describedby="f-welcome-description-hint"${dis}>${esc(s.description)}</textarea>
        <span class="hint" id="f-welcome-description-hint">${esc(ui("uiWelcomeDescriptionHint"))}</span>
      </label>
      ${status(line, failed)}
      <div class="wb-form-actions">${button("welcome-go", "uiWelcomeGo", "submit")}</div>
    </form>`;
}

/** Mounts the tile's body into the page's box, reads the pod, and answers the coordinator's presses. */
export function mountWelcome(box: HTMLElement, deps: WelcomeDeps): WelcomeHandle {
  const ui = welcomeWords(deps.tile);
  const life = new AbortController();
  const s: State = { status: "loading", slogan: "", description: deps.description, message: "", retry: "none", from: "form", link: "", copied: false };
  let working = false;

  const paint = (focus: string | null = null) => {
    if (life.signal.aborted) return;
    box.innerHTML = renderWelcome(deps.tile, s, deps.name);
    if (focus) box.querySelector<HTMLElement>(focus)?.focus();
  };

  /**
   * The pod's answer, drawn: the form only on "none", carrying on only on "incomplete" (home's own config), the
   * link only on "done". A config home didn't write, with something missing, is said in plain words, no button.
   */
  const show = (read: CollectiveState, focus: string | null) => {
    if (read.state === "foreign") {
      const part = { roster: ui("uiWelcomeMissingRoster"), inbox: ui("uiWelcomeMissingInbox"), public: ui("uiWelcomeMissingPublic") };
      Object.assign(s, { status: "failed", retry: "none", message: ui("uiWelcomeNotOurs", { missing: read.missing.map((m) => part[m]).join("; ") }) });
      paint(focus ? "#welcome-status" : null);
      return;
    }
    if (read.state === "done") {
      s.status = "done";
      s.link = read.link;
      paint();
      deps.onDone?.();
      if (focus) box.querySelector<HTMLElement>(focus)?.focus();
      return;
    }
    s.from = read.state === "incomplete" ? "unfinished" : "form";
    s.status = read.state === "incomplete" ? "unfinished" : "form";
    s.message = "";
    paint(focus);
  };

  const read = async (focus: string | null) => {
    s.status = "loading";
    paint();
    try {
      show(await deps.load(), focus);
    } catch (err) {
      Object.assign(s, { status: "failed" }, welcomeFailure(err, ui, true));
      console.warn("The collective could not be read:", err);
      paint(focus ? "#welcome-status" : null);
    }
  };

  const setUp = async () => {
    if (working) return;
    const form = box.querySelector<HTMLFormElement>("#f-welcome");
    if (form) {
      s.slogan = (form.elements.namedItem("slogan") as HTMLInputElement).value;
      s.description = (form.elements.namedItem("description") as HTMLTextAreaElement).value;
    }
    working = true;
    s.status = "working";
    paint();
    try {
      const done = await deps.setUp({ slogan: s.slogan, description: s.description });
      working = false;
      show(done, "#welcome-link-label");
    } catch (err) {
      working = false;
      Object.assign(s, { status: "failed" }, welcomeFailure(err, ui, false));
      console.warn("The collective was not set up:", err);
      paint("#welcome-status");
    }
  };

  box.addEventListener("submit", (event) => {
    if ((event.target as HTMLElement).id !== "f-welcome") return;
    event.preventDefault();
    void setUp();
  }, { signal: life.signal });
  box.addEventListener("input", (event) => {
    const t = event.target as HTMLInputElement;
    if (t.name === "slogan") s.slogan = t.value;
    if (t.name === "description") s.description = t.value;
  }, { signal: life.signal });
  box.addEventListener("click", (event) => {
    const target = (event.target as Element).closest<HTMLElement>("button");
    if (!target) return;
    if (target.id === "welcome-go" && target.getAttribute("type") !== "submit") void setUp();
    else if (target.id === "welcome-retry") void read("#welcome-status");
    else if (target.id === "welcome-copy") {
      // The link is on screen as text either way: a refused clipboard costs the shortcut, not the link.
      void navigator.clipboard
        ?.writeText(target.dataset.copy ?? "")
        .then(() => {
          s.copied = true;
          const said = box.querySelector<HTMLElement>("#welcome-copied");
          if (said) said.textContent = ui("uiWelcomeCopied");
        })
        .catch(() => {});
    }
  }, { signal: life.signal });

  void read(null);
  return { busy: () => working, destroy: () => life.abort() };
}
