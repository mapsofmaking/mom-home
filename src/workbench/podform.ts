/**
 * The pod door's form (Story 14.3 AC2): the space's address, the email, the
 * passphrase twice. Nothing else is asked.
 *
 * Two rules from this app's history shape it:
 * - A re-render destroys what the screen held (CLAUDE.md). The form is drawn
 *   once; every check afterwards updates its messages IN PLACE, so no error
 *   ever clears a field (AC2). The passphrase lives only in its input: it is
 *   never copied into page state, the draft or storage (AC3).
 * - The form never submits natively. A GET submit would put every field, the
 *   passphrase included, in the URL, the history and the server's access log:
 *   the page handles `submit` with preventDefault, always.
 *
 * What a message says is the tree's (`onb:ui*` on `:keep`). Nothing is sent from
 * here: "Create it" hands the fields to `lib/register.ts` (the page does), and
 * what the server answers comes back here as a message on the field it concerns
 * (AC5), each with one way forward.
 */
import { MAX_NAME, podAddress, podNameProblem, suggestPodName, type NameProblem } from "../lib/podname";
import type { AccountError } from "../lib/register";
import type { Tile } from "../tree/parse";
import { bernard, esc } from "./html";
import type { ThresholdUiKey } from "./threshold";

/** What survives a redraw of the step. The passphrase is never part of it. */
export interface PodFormState {
  name: string;
  email: string;
  /** Typed by the coordinator: a later change to the draft no longer overwrites it. */
  nameTouched: boolean;
  emailTouched: boolean;
}

export const MIN_PASSPHRASE = 8;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Ui = (name: ThresholdUiKey, vars?: Record<string, string>) => string;

/** One field: label, input, its normal hint, and an empty line an error fills in place. */
function field(id: string, label: string, input: string, hint = "", hintClass = "hint"): string {
  return `<div class="wb-field">
      <label for="p-${id}">${esc(label)}</label>
      ${input}
      ${hint ? `<span class="${hintClass}" id="p-${id}-hint">${hint}</span>` : ""}
      <span class="hint is-error" id="p-${id}-err" data-err hidden></span>
    </div>`;
}

export function renderPodForm(tile: Tile, state: PodFormState, ui: Ui): string {
  const describedBy = (id: string, hint: boolean) => `${hint ? `p-${id}-hint ` : ""}p-${id}-err`;
  return `
    ${bernard(tile.lines.sayPod)}
    <form id="f-pod" class="wb-form" novalidate autocomplete="on" action="#" method="post">
      <div id="pod-taken" class="wb-taken" hidden>
        <span class="status-label broken">${esc(ui("uiTakenLabel"))}</span>
        ${bernard(tile.lines.sayTaken)}
      </div>
      ${field(
        "name",
        ui("uiPodAddress"),
        `<input id="p-name" name="name" type="text" class="mono" value="${esc(state.name)}" autocomplete="off"
           autocapitalize="none" spellcheck="false" enterkeyhint="next" aria-describedby="${describedBy("name", true)}" required />`,
        esc(state.name ? podAddress(state.name) : ""),
        "hint mono"
      )}
      ${field(
        "email",
        ui("uiPodEmail"),
        `<input id="p-email" name="email" type="email" value="${esc(state.email)}" autocomplete="email"
           enterkeyhint="next" aria-describedby="${describedBy("email", true)}" required />`,
        esc(ui("uiPodEmailHint"))
      )}
      <div class="wb-pass-pair">
        ${field(
          "pass",
          ui("uiPodPass"),
          `<span class="wb-inline"><input id="p-pass" name="pass" type="password" autocomplete="new-password"
             placeholder="${esc(ui("uiPodPassExample"))}" enterkeyhint="next" aria-describedby="${describedBy("pass", false)} p-pass-rule" required />
             <button type="button" class="btn" id="pod-show" aria-pressed="false" aria-label="${esc(ui("uiPodShowLabel"))}">${esc(ui("uiPodShow"))}</button></span>`
        )}
        ${field(
          "pass2",
          ui("uiPodPassAgain"),
          `<input id="p-pass2" name="pass2" type="password" autocomplete="new-password" enterkeyhint="done"
             aria-describedby="${describedBy("pass2", false)}" required />`
        )}
      </div>
      <p class="wb-aside" id="p-pass-rule">${esc(ui("uiPodPassHint"))}</p>
      ${bernard(tile.lines.sayConsent)}
      <div class="wb-form-actions">
        <button type="submit" class="btn btn-primary wb-cta">${esc(ui("uiPodCreate"))}</button>
        <button type="button" class="inline-link" id="pod-other">${esc(ui("uiPodOtherDoor"))}</button>
      </div>
      <p class="wb-aside" id="pod-status" role="status"></p>
    </form>`;
}

const input = (form: HTMLFormElement, name: string) => form.elements.namedItem(name) as HTMLInputElement;
const errorOf = (form: HTMLFormElement, id: string) => form.querySelector<HTMLElement>(`#p-${id}-err`)!;

/** Puts a message on its own field, or clears it. Never touches what was typed. */
function say(form: HTMLFormElement, id: string, message: string | null): boolean {
  const el = errorOf(form, id);
  const field = form.querySelector<HTMLInputElement>(`#p-${id}`)!;
  el.textContent = message ?? "";
  el.hidden = !message;
  if (message) field.setAttribute("aria-invalid", "true");
  else field.removeAttribute("aria-invalid");
  return message === null;
}

/** Typing again withdraws that field's message; the check comes back after a pause or on leaving the field. */
export function clearError(form: HTMLFormElement, id: "name" | "email" | "pass" | "pass2"): void {
  say(form, id, null);
}

/** The URL under the address, live as it is typed (AC2): even before it is valid, so the person sees what they are making. */
export function showAddress(form: HTMLFormElement): void {
  const hint = form.querySelector<HTMLElement>("#p-name-hint")!;
  const name = input(form, "name").value.trim();
  hint.textContent = name ? podAddress(name) : "";
}

const ADDRESS_LINES: Record<NameProblem, "uiAddrEmpty" | "uiAddrBad" | "uiAddrLong"> = {
  empty: "uiAddrEmpty",
  format: "uiAddrBad",
  long: "uiAddrLong",
};

/** The format check; "taken" comes only from the server, after "Create it" (14.0). */
export function checkName(form: HTMLFormElement, ui: Ui): boolean {
  const problem = podNameProblem(input(form, "name").value.trim());
  return say(form, "name", problem ? ui(ADDRESS_LINES[problem]) : null);
}

export function checkEmail(form: HTMLFormElement, ui: Ui): boolean {
  return say(form, "email", EMAIL.test(input(form, "email").value.trim()) ? null : ui("uiEmailBad"));
}

/** Rules on the first field; the second only has to match, and is only judged once something is in it (or on submit). */
export function checkPass(form: HTMLFormElement, ui: Ui, which: "pass" | "pass2" | "both"): boolean {
  const first = input(form, "pass").value;
  const second = input(form, "pass2").value;
  let ok = true;
  if (which !== "pass2") {
    const problem = /\s/.test(first) ? ui("uiPassSpace") : first.length < MIN_PASSPHRASE ? ui("uiPassShort") : null;
    ok = say(form, "pass", problem) && ok;
  }
  if (which === "pass2" || which === "both" || second) {
    ok = say(form, "pass2", first === second ? null : ui("uiPassMismatch")) && ok;
  }
  return ok;
}

/** Every check, in field order; the first field with a problem, for focus. Messages stay on every field that has one. */
export function checkPodForm(form: HTMLFormElement, ui: Ui): HTMLInputElement | null {
  const results: [boolean, string][] = [
    [checkName(form, ui), "name"],
    [checkEmail(form, ui), "email"],
    [checkPass(form, ui, "pass"), "pass"],
    [checkPass(form, ui, "pass2"), "pass2"],
  ];
  const bad = results.find(([ok]) => !ok);
  return bad ? input(form, bad[1]) : null;
}

/** One Show toggle for both passphrase fields. */
export function togglePassphrase(form: HTMLFormElement, ui: Ui): void {
  const button = form.querySelector<HTMLButtonElement>("#pod-show")!;
  const show = button.getAttribute("aria-pressed") !== "true";
  for (const name of ["pass", "pass2"]) input(form, name).type = show ? "text" : "password";
  button.setAttribute("aria-pressed", String(show));
  button.textContent = ui(show ? "uiPodHide" : "uiPodShow");
  button.setAttribute("aria-label", ui(show ? "uiPodHideLabel" : "uiPodShowLabel"));
}

/** "Create it" pressed: one attempt at a time, and the person sees it is working. */
export function setCreating(form: HTMLFormElement, ui: Ui, creating: boolean): void {
  const button = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  button.disabled = creating;
  button.setAttribute("aria-busy", String(creating));
  form.querySelector<HTMLElement>("#pod-status")!.textContent = creating ? ui("uiPodCreating") : "";
}

/** Says something under "Create it" (the status line): what isn't about one field. */
export function sayStatus(form: HTMLFormElement, text: string): void {
  form.querySelector<HTMLElement>("#pod-status")!.textContent = text;
}

/**
 * Another address for a taken one: the name with the town after it
 * ("atelier-du-canal-anderlecht", storyboard S2), when that makes a valid one.
 */
export function takenSuggestion(name: string, city: string | undefined): string | null {
  const town = suggestPodName(city);
  if (!town) return null;
  const s = `${name}-${town}`.slice(0, MAX_NAME).replace(/-+$/, "");
  return s !== name && podNameProblem(s) === null ? s : null;
}

/**
 * Once the provider holds the email, a retry cannot change it (lib/register.ts):
 * the field shows the one it holds, read-only, and says why.
 */
export function holdEmail(form: HTMLFormElement, ui: Ui, email: string): void {
  const field = input(form, "email");
  field.value = email;
  field.readOnly = true;
  form.querySelector<HTMLElement>("#p-email-hint")!.textContent = ui("uiEmailKept");
  say(form, "email", null);
}

/** The wait, as the gateway said it (Retry-After), rounded up to whole minutes; vague only when it didn't say. */
export function busyLine(ui: Ui, retryAfter: number | null): string {
  if (retryAfter === null) return ui("uiBusy");
  const minutes = Math.ceil(retryAfter / 60);
  return minutes <= 1 ? ui("uiBusyMinute") : ui("uiBusyMinutes", { minutes: String(minutes) });
}

/**
 * What the pod server answered, said where it can be fixed (AC5): on the field it
 * concerns, or under "Create it". Returns the element the keyboard should go to.
 * Nothing typed is cleared.
 */
export function showAccountError(
  form: HTMLFormElement,
  ui: Ui,
  err: AccountError,
  city: string | undefined
): HTMLElement {
  const taken = form.querySelector<HTMLElement>("#pod-taken")!;
  taken.hidden = err.code !== "name-taken";
  const button = form.querySelector<HTMLElement>('button[type="submit"]')!;
  switch (err.code) {
    case "name-taken": {
      const alt = takenSuggestion(input(form, "name").value.trim(), city);
      say(form, "name", alt ? ui("uiTakenTry", { suggestion: alt }) : ui("uiTakenPick"));
      return input(form, "name");
    }
    case "bad-name":
      checkName(form, ui) && say(form, "name", ui("uiAddrBad"));
      return input(form, "name");
    case "bad-email":
      say(form, "email", ui("uiEmailBad"));
      return input(form, "email");
    case "email-taken":
      say(form, "email", ui("uiEmailTaken"));
      return input(form, "email");
    case "bad-password":
      say(form, "pass", ui("uiPassRefused"));
      return input(form, "pass");
    case "rate-limited":
      sayStatus(form, busyLine(ui, err.retryAfter));
      return button;
    case "unreachable":
      sayStatus(form, ui(err.nothingCreated ? "uiUnreachable" : "uiHalfDone"));
      return button;
    default:
      sayStatus(
        form,
        err.nothingCreated ? ui("uiProviderSaid", { detail: err.message.replace(/[.\s]+$/, "") }) : ui("uiHalfDone")
      );
      return button;
  }
}
