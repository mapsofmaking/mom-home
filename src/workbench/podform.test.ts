import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Offers } from "../lib/provider";
import { AccountError, type NewAccount, type SignUp } from "../lib/register";
import { parseTree } from "../tree/parse";
import { renderPage } from "./page";
import type { Draft } from "./previews";

const tree = parseTree(readFileSync(join(__dirname, "../../public/onboarding.ttl"), "utf8"));
const keep = tree.tiles.find((t) => t.id === "keep")!;

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { disconnect() {} observe() {} });
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: () => {} }));
});

const settle = () => new Promise((r) => setTimeout(r, 0));

/** Tile B opened on the pod door's form, tile A done with this draft. */
const made: NewAccount = { webId: "https://atelier-du-canal.pod.mapsofmaking.org/profile/card#me", pod: "https://atelier-du-canal.pod.mapsofmaking.org/", email: "hello@atelier.example", loggedIn: true };

async function openForm(
  draft: Draft = { name: "Atelier du Canal", city: "Anderlecht", email: "hello@atelier.example" },
  offers: Offers = "open",
  createAccount: (i: SignUp) => Promise<NewAccount> = vi.fn(async () => made),
  signIn: () => Promise<void> = vi.fn(async () => {})
) {
  const root = document.createElement("div");
  document.body.append(root);
  const fetchSpy = vi.fn();
  vi.stubGlobal("fetch", fetchSpy);
  renderPage(root, tree, {
    mode: "onboarding", done: new Set(["describe"]), draft, fold: { folded: false },
    onSignIn: () => {}, onSignOut: () => {}, readOffers: async () => offers, createAccount, signIn,
  });
  await settle();
  root.querySelector<HTMLElement>('[data-door="pod"]')!.click();
  const form = root.querySelector<HTMLFormElement>("#f-pod")!;
  const f = (id: string) => root.querySelector<HTMLInputElement>(`#p-${id}`)!;
  const err = (id: string) => root.querySelector<HTMLElement>(`#p-${id}-err`)!;
  const type = (id: string, value: string) => {
    f(id).value = value;
    f(id).dispatchEvent(new Event("input", { bubbles: true }));
  };
  const leave = (id: string) => f(id).dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  const submit = () => {
    const e = new Event("submit", { cancelable: true, bubbles: true });
    form.dispatchEvent(e);
    return e;
  };
  return { root, form, f, err, type, leave, submit, fetchSpy, createAccount, signIn };
}

describe("the pod form (14.3 AC2)", () => {
  it("opens in place of the doors, headed by the door's name, with only what's missing", async () => {
    const { root, form } = await openForm();
    expect(root.querySelector(".wb-step-title")!.textContent).toBe(keep.ui.uiDoorPod);
    expect(root.querySelector(".wb-doors")).toBeNull();
    expect([...form.elements].filter((e) => e.tagName === "INPUT").map((e) => (e as HTMLInputElement).name)).toEqual(["name", "email", "pass", "pass2"]);
  });

  it("suggests the address from the space's name, shows its full URL, and takes the email from the description", async () => {
    const { f, root } = await openForm();
    expect(f("name").value).toBe("atelier-du-canal");
    expect(root.querySelector("#p-name-hint")!.textContent).toBe("https://atelier-du-canal.pod.mapsofmaking.org");
    expect(f("email").value).toBe("hello@atelier.example");
  });

  it("suggests nothing, and says nothing yet, when the name has no usable letters", async () => {
    const { f, err } = await openForm({ name: "☃ !!!", city: "Anderlecht" });
    expect(f("name").value).toBe("");
    expect(err("name").hidden).toBe(true);
  });

  it("types over the suggestion: the URL follows live, the format shows after a pause or on leaving", async () => {
    // Fake timers only once the form is open: openForm itself waits on a real timer.
    const { root, f, err, type } = await openForm();
    vi.useFakeTimers();
    try {
      type("name", "Weld Done");
      expect(root.querySelector("#p-name-hint")!.textContent).toBe("https://Weld Done.pod.mapsofmaking.org");
      expect(err("name").hidden).toBe(true);
      vi.advanceTimersByTime(700);
      expect(err("name").textContent).toBe(keep.ui.uiAddrBad);
      expect(f("name").getAttribute("aria-invalid")).toBe("true");
      type("name", "weld-done");
      expect(err("name").hidden).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("checks the format the moment the field is left, and a too-long address says so", async () => {
    const { f, err, type, leave } = await openForm();
    type("name", "-nope");
    leave("name");
    expect(err("name").textContent).toBe(keep.ui.uiAddrBad);
    type("name", "a".repeat(64));
    leave("name");
    expect(err("name").textContent).toBe(keep.ui.uiAddrLong);
    type("name", "");
    leave("name");
    expect(err("name").textContent).toBe(keep.ui.uiAddrEmpty);
    expect(f("name").value).toBe("");
  });

  it("checks the suggested address as soon as the form opens", async () => {
    // 'x' repeated is valid; a name that slugs to a leading digit-only label is valid too: force a bad one through the draft's long name.
    const { err, f } = await openForm({ name: "a".repeat(80), city: "x" });
    expect(f("name").value.length).toBe(63);
    expect(err("name").hidden).toBe(true);
  });
});

describe("the passphrase (14.3 AC2, AC3)", () => {
  it("is typed twice, with one Show for both, and autocomplete says it is new", async () => {
    const { root, f } = await openForm();
    expect(f("pass").autocomplete).toBe("new-password");
    expect(f("pass2").autocomplete).toBe("new-password");
    const show = root.querySelector<HTMLButtonElement>("#pod-show")!;
    show.click();
    expect([f("pass").type, f("pass2").type]).toEqual(["text", "text"]);
    expect(show.getAttribute("aria-pressed")).toBe("true");
    expect(show.textContent).toBe(keep.ui.uiPodHide);
    show.click();
    expect([f("pass").type, f("pass2").type]).toEqual(["password", "password"]);
  });

  it("says what is wrong on its own field: too short, spaces, not matching", async () => {
    const { err, type, leave } = await openForm();
    type("pass", "short");
    leave("pass");
    expect(err("pass").textContent).toBe(keep.ui.uiPassShort);
    type("pass", "two words here");
    leave("pass");
    expect(err("pass").textContent).toBe(keep.ui.uiPassSpace);
    type("pass", "Rock-Paper-Scissors-Lizard-Spock");
    leave("pass");
    expect(err("pass").hidden).toBe(true);
    type("pass2", "Rock-Paper-Scissors");
    leave("pass2");
    expect(err("pass2").textContent).toBe(keep.ui.uiPassMismatch);
    type("pass2", "Rock-Paper-Scissors-Lizard-Spock");
    leave("pass2");
    expect(err("pass2").hidden).toBe(true);
  });

  it("leaving the first field says nothing about 'Same again' while it is still empty", async () => {
    const { err, type, leave } = await openForm();
    type("pass", "Rock-Paper-Scissors-Lizard-Spock");
    leave("pass");
    expect(err("pass2").hidden).toBe(true);
  });
});

describe("Create it: the form's own checks", () => {
  const good = "Rock-Paper-Scissors-Lizard-Spock";

  it("never lets the browser submit: a native submit would put the passphrase in the URL", async () => {
    const { submit, type } = await openForm();
    type("pass", good);
    type("pass2", good);
    expect(submit().defaultPrevented).toBe(true);
    // And with a problem too.
    type("pass2", "other");
    expect(submit().defaultPrevented).toBe(true);
  });

  it("the form is not a GET that could carry fields", async () => {
    const { form } = await openForm();
    expect(form.getAttribute("method")).toBe("post");
    expect(form.hasAttribute("novalidate")).toBe(true);
  });

  it("with a problem, lands on the first field that has one, and keeps every other message and everything typed", async () => {
    const { f, err, type, submit } = await openForm();
    type("email", "not-an-email");
    type("pass", good);
    type("pass2", "different");
    submit();
    expect(document.activeElement).toBe(f("email"));
    expect(err("email").textContent).toBe(keep.ui.uiEmailBad);
    expect(err("pass2").textContent).toBe(keep.ui.uiPassMismatch);
    expect(f("pass").value).toBe(good);
    expect(f("pass2").value).toBe("different");
    expect(f("email").value).toBe("not-an-email");
    expect(f("name").value).toBe("atelier-du-canal");
  });

  it("with a problem, sends nothing", async () => {
    const { type, submit, createAccount } = await openForm();
    type("pass", good);
    type("pass2", "different");
    submit();
    expect(createAccount).not.toHaveBeenCalled();
  });

  it("the passphrase is never copied into the page: back at the doors and into the form again, it is gone", async () => {
    // Not the form's own placeholder example, which is on the page by design.
    const secret = "correct-horse-battery-staple";
    const { root, type, f } = await openForm();
    type("pass", secret);
    type("pass2", secret);
    root.querySelector<HTMLElement>("#pod-other")!.click();
    root.querySelector<HTMLElement>('[data-door="pod"]')!.click();
    expect(f("pass").value).toBe("");
    expect(root.innerHTML).not.toContain(secret);
  });
});

describe("the other door, and what survives", () => {
  it("'Take the other door' goes back to the doors with the self-host answer", async () => {
    const { root } = await openForm();
    root.querySelector<HTMLElement>("#pod-other")!.click();
    expect(root.querySelector(".wb-doors")).not.toBeNull();
    expect(root.querySelector("#reply")!.textContent).toContain(keep.ui.uiSelfSoon);
  });

  it("an address and an email the coordinator typed come back; an untouched one follows the description", async () => {
    const draft: Draft = { name: "Atelier du Canal", city: "Anderlecht", email: "hello@atelier.example" };
    const { root, type, f } = await openForm(draft);
    type("name", "my-own-name");
    root.querySelector<HTMLElement>("#pod-other")!.click();
    draft.email = "changed@atelier.example";
    draft.name = "Another Name";
    root.querySelector<HTMLElement>('[data-door="pod"]')!.click();
    expect(f("name").value).toBe("my-own-name");
    expect(f("email").value).toBe("changed@atelier.example");
  });
});

describe("Create it: the account (14.3 AC3, AC5)", () => {
  const good = "correct-horse-battery-staple";
  const fill = (o: Awaited<ReturnType<typeof openForm>>) => {
    o.type("pass", good);
    o.type("pass2", good);
  };

  it("hands the three fields to the account call, once, says the pod is ready, and signs in", async () => {
    const o = await openForm();
    fill(o);
    o.submit();
    expect(o.root.querySelector("#pod-status")!.textContent).toBe(keep.ui.uiPodCreating);
    expect(o.root.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
    // A second press while the first is on its way does nothing (the gateway counts every attempt).
    o.submit();
    await settle();
    expect(o.createAccount).toHaveBeenCalledTimes(1);
    expect(o.createAccount).toHaveBeenCalledWith({ name: "atelier-du-canal", email: "hello@atelier.example", password: good });
    expect(o.root.querySelector("#pod-status")!.textContent).toBe(keep.ui.uiPodCreated.replace("{address}", made.pod));
    expect(o.signIn).toHaveBeenCalledTimes(1);
  });

  it("a taken address: the label, Bernard's line, a suggestion on the field; everything typed is kept", async () => {
    const o = await openForm(undefined, "open", vi.fn(async () => { throw new AccountError("name-taken", "already exists"); }));
    fill(o);
    o.submit();
    await settle();
    expect(o.root.querySelector<HTMLElement>("#pod-taken")!.hidden).toBe(false);
    expect(o.root.querySelector("#pod-taken")!.textContent).toContain(keep.lines.sayTaken);
    expect(o.err("name").textContent).toBe(keep.ui.uiTakenTry.replace("{suggestion}", "atelier-du-canal-anderlecht"));
    expect(document.activeElement).toBe(o.f("name"));
    expect([o.f("pass").value, o.f("pass2").value, o.f("email").value]).toEqual([good, good, "hello@atelier.example"]);
  });

  it("each answer has its own place: email taken, passphrase refused, unreachable, busy, half-done", async () => {
    const cases: [AccountError, (o: Awaited<ReturnType<typeof openForm>>) => string][] = [
      [new AccountError("email-taken", "x"), (o) => o.err("email").textContent!],
      [new AccountError("bad-password", "x"), (o) => o.err("pass").textContent!],
      [new AccountError("unreachable", "x", true), (o) => o.root.querySelector("#pod-status")!.textContent!],
      [new AccountError("unreachable", "x", false), (o) => o.root.querySelector("#pod-status")!.textContent!],
      [new AccountError("rate-limited", "x", true), (o) => o.root.querySelector("#pod-status")!.textContent!],
      [new AccountError("provider", "Could not create the account: boom", true), (o) => o.root.querySelector("#pod-status")!.textContent!],
    ];
    const expected = [
      keep.ui.uiEmailTaken,
      keep.ui.uiPassRefused,
      keep.ui.uiUnreachable,
      keep.ui.uiHalfDone,
      keep.ui.uiBusy,
      keep.ui.uiProviderSaid.replace("{detail}", "Could not create the account: boom"),
    ];
    for (const [i, [error, where]] of cases.entries()) {
      const o = await openForm(undefined, "open", vi.fn(async () => { throw error; }));
      fill(o);
      o.submit();
      await settle();
      expect(where(o), error.code).toBe(expected[i]);
      expect(o.root.querySelector<HTMLElement>("#pod-taken")!.hidden).toBe(true);
      expect(o.f("pass").value).toBe(good);
      o.root.remove();
    }
  });
});

describe("after the pod is made (14.3 AC6)", () => {
  const good = "correct-horse-battery-staple";
  const done = async (signIn?: () => Promise<void>) => {
    sessionStorage.clear();
    const o = await openForm(undefined, "open", undefined, signIn);
    o.type("pass", good);
    o.type("pass2", good);
    o.submit();
    await settle();
    return o;
  };

  it("leaves the tab a marker with the WebID and pod, never the email or passphrase", async () => {
    await done();
    const raw = sessionStorage.getItem("mom-home:pod-made")!;
    expect(JSON.parse(raw)).toEqual({ webId: made.webId, pod: made.pod });
    expect(raw).not.toContain(good);
    expect(raw).not.toContain("hello@atelier.example");
  });

  it("empties the passphrase fields before leaving, so Back can't bring them back", async () => {
    const o = await done();
    expect([o.f("pass").value, o.f("pass2").value]).toEqual(["", ""]);
    expect(o.root.innerHTML).not.toContain(good);
  });

  it("if signing in doesn't start, says the pod exists, and the button signs in: it never creates a second account", async () => {
    const signIn = vi.fn(async () => { throw new Error("offline"); });
    const o = await done(signIn);
    expect(o.root.querySelector("#pod-status")!.textContent).toBe(keep.ui.uiSignInFailed.replace("{address}", made.pod));
    const button = o.root.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    expect(button.textContent).toBe(keep.ui.uiSignIn);
    // The passphrase fields are empty now: pressing again must still not stop at the form's checks, nor create.
    o.submit();
    await settle();
    expect(o.createAccount).toHaveBeenCalledTimes(1);
    expect(signIn).toHaveBeenCalledTimes(2);
  });
});

describe("back from the sign-in (14.3 AC6)", () => {
  it("opens on tile B, which says the pod is ready and nothing is written yet", async () => {
    const root = document.createElement("div");
    renderPage(root, tree, {
      mode: "workbench", who: "Atelier", done: new Set(), draft: { name: "Atelier du Canal" }, fold: { folded: false },
      onSignIn: () => {}, onSignOut: () => {}, readOffers: async () => "open",
      podReady: { webId: made.webId, pod: made.pod },
    });
    expect(root.querySelector(".wb-step-title")!.textContent).toBe(keep.title);
    expect(root.querySelector(".bernard-voice")!.textContent).toBe(`— ${keep.lines.saidPodReady}`);
    expect(root.querySelector<HTMLAnchorElement>("a.mono")!.href).toBe(made.pod);
    expect(root.querySelector(".wb-doors")).toBeNull();
  });

  it("without the marker, the workbench is as before", async () => {
    const root = document.createElement("div");
    renderPage(root, tree, {
      mode: "workbench", who: "Atelier", done: new Set(), draft: {}, fold: { folded: false },
      onSignIn: () => {}, onSignOut: () => {},
    });
    expect(root.querySelector(".bernard-voice")?.textContent ?? "").not.toBe(`— ${keep.lines.saidPodReady}`);
  });
});
