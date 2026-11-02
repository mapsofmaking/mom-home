/**
 * The account API, faked. Adapted from solid-backoffice `css-account.test.ts`
 * (c9243b3), with the steps this copy adds: the login, the name rule, and the
 * failures that are not the server saying no.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./auth", () => ({ authFetch: vi.fn() }));
import { AccountError, createAccount, pendingEmail, resetPendingSignUp } from "./register";

const ISSUER = "https://pod.example/";
const INPUT = { name: "weld-done", email: "hello@weld.example", password: "Rock-Paper-Scissors" };

let calls: { step: string; init?: RequestInit }[];
/** One step answers with this, once: [status, message]. */
let fail: Record<string, [number, string]>;
let throws: Set<string>;

const fakeFetch: typeof fetch = async (input, init) => {
  const url = String(input);
  const step =
    url === ISSUER + ".account/" ? (init?.headers ? "controls" : "index") : url.replace(ISSUER + "api/", "");
  calls.push({ step, init });
  if (throws.has(step)) {
    throws.delete(step);
    throw new TypeError("Failed to fetch");
  }
  if (fail[step]) {
    const [status, message] = fail[step];
    delete fail[step];
    return new Response(JSON.stringify({ message }), { status });
  }
  const body: Record<string, unknown> = {
    index: { controls: { account: { create: ISSUER + "api/create" }, password: { login: ISSUER + "api/login" } } },
    create: { authorization: "t0k3n" },
    controls: {
      controls: {
        password: { create: ISSUER + "api/password", login: ISSUER + "api/login" },
        account: { pod: ISSUER + "api/pod" },
      },
    },
    password: {},
    pod: { pod: "https://weld-done.pod.example/", webId: "https://weld-done.pod.example/profile/card#me" },
    login: {},
  };
  return new Response(JSON.stringify(body[step]), { status: 200 });
};
const steps = () => calls.map((c) => c.step);

beforeEach(() => {
  calls = [];
  fail = {};
  throws = new Set();
  resetPendingSignUp();
});

describe("createAccount", () => {
  it("creates the account, the passphrase login, the pod, then logs in (14.0: the login sets the cookie)", async () => {
    const made = await createAccount(ISSUER, INPUT, fakeFetch);
    expect(steps()).toEqual(["index", "create", "controls", "password", "pod", "login"]);
    expect(made).toEqual({
      pod: "https://weld-done.pod.example/",
      webId: "https://weld-done.pod.example/profile/card#me",
      email: INPUT.email,
      loggedIn: true,
    });
    const login = calls.find((c) => c.step === "login")!.init!;
    expect(login.credentials).toBe("include");
    expect(JSON.parse(String(login.body))).toMatchObject({ email: INPUT.email, password: INPUT.password });
  });

  it("sends the creation with credentials, so the provider can set its cookie", async () => {
    await createAccount(ISSUER, INPUT, fakeFetch);
    expect(calls.find((c) => c.step === "create")!.init!.credentials).toBe("include");
  });

  it("makes no request at all for an empty name: CSS would claim the server root", async () => {
    await expect(createAccount(ISSUER, { ...INPUT, name: "" }, fakeFetch)).rejects.toMatchObject({ code: "bad-name", nothingCreated: true });
    expect(calls).toEqual([]);
  });

  it("checks the server's own name rule (up to 63) before sending anything", async () => {
    await expect(createAccount(ISSUER, { ...INPUT, name: "-x" }, fakeFetch)).rejects.toMatchObject({ code: "bad-name" });
    await expect(createAccount(ISSUER, { ...INPUT, name: "a".repeat(64) }, fakeFetch)).rejects.toMatchObject({ code: "bad-name" });
    expect(calls).toEqual([]);
    await createAccount(ISSUER, { ...INPUT, name: "a".repeat(63) }, fakeFetch);
  });

  it("refuses a short passphrase or one with spaces before sending", async () => {
    for (const password of ["short", "has a space in"]) {
      await expect(createAccount(ISSUER, { ...INPUT, password }, fakeFetch)).rejects.toMatchObject({ code: "bad-password", nothingCreated: true });
    }
    expect(calls).toEqual([]);
  });

  it("a taken name is retried on the SAME account, without sending the passphrase again", async () => {
    fail.pod = [400, "There already is a resource at https://weld-done.pod.example/"];
    await expect(createAccount(ISSUER, INPUT, fakeFetch)).rejects.toMatchObject({ code: "name-taken", nothingCreated: false });
    expect(pendingEmail(ISSUER)).toBe(INPUT.email);
    calls = [];
    await createAccount(ISSUER, { ...INPUT, name: "weld-done-marolles" }, fakeFetch);
    expect(steps()).toEqual(["controls", "pod", "login"]);
    expect(calls.find((c) => c.step === "pod")!.init!.body).toBe(JSON.stringify({ name: "weld-done-marolles" }));
    expect(pendingEmail(ISSUER)).toBeNull();
  });

  it("a reserved name reads as taken: either way the person picks another", async () => {
    fail.pod = [400, '"mcp" is reserved on this server. Please choose another name.'];
    await expect(createAccount(ISSUER, { ...INPUT, name: "mcp" }, fakeFetch)).rejects.toMatchObject({ code: "name-taken" });
  });

  it("once the provider holds the email, a retry ignores a changed one (the account keeps the first)", async () => {
    fail.pod = [400, "already exists"];
    await createAccount(ISSUER, INPUT, fakeFetch).catch(() => {});
    const made = await createAccount(ISSUER, { ...INPUT, name: "other", email: "changed@weld.example", password: "" }, fakeFetch);
    expect(made.email).toBe(INPUT.email);
  });

  it("an email already in use says so, with the account kept for the retry", async () => {
    fail.password = [400, "There already is a login for this e-mail address."];
    await expect(createAccount(ISSUER, INPUT, fakeFetch)).rejects.toMatchObject({ code: "email-taken", nothingCreated: false });
    calls = [];
    await createAccount(ISSUER, { ...INPUT, email: "other@weld.example" }, fakeFetch);
    expect(steps()).toEqual(["controls", "password", "pod", "login"]);
  });

  it("no answer at all is 'unreachable', never a raw error; before the account exists, nothing was created", async () => {
    throws.add("index");
    const err = await createAccount(ISSUER, INPUT, fakeFetch).catch((e) => e);
    expect(err).toBeInstanceOf(AccountError);
    expect(err).toMatchObject({ code: "unreachable", nothingCreated: true });
  });

  it("no answer half-way is 'unreachable' with the account kept, so 'Create it' again continues", async () => {
    throws.add("pod");
    await expect(createAccount(ISSUER, INPUT, fakeFetch)).rejects.toMatchObject({ code: "unreachable", nothingCreated: false });
    calls = [];
    await createAccount(ISSUER, INPUT, fakeFetch);
    expect(steps()).toEqual(["controls", "pod", "login"]);
  });

  it("the gateway's rate limit is 'rate-limited'", async () => {
    fail.create = [429, "Too Many Requests"];
    await expect(createAccount(ISSUER, INPUT, fakeFetch)).rejects.toMatchObject({ code: "rate-limited", nothingCreated: true });
  });

  it("a login that fails still returns the account: the provider's login page asks later (flow B)", async () => {
    fail.login = [400, "Invalid"];
    const made = await createAccount(ISSUER, INPUT, fakeFetch);
    expect(made.loggedIn).toBe(false);
    throws.add("login");
    resetPendingSignUp();
    expect((await createAccount(ISSUER, INPUT, fakeFetch)).loggedIn).toBe(false);
  });

  it("another server starts over: a half-built account is only resumed on its own server", async () => {
    fail.pod = [400, "already exists"];
    await createAccount(ISSUER, INPUT, fakeFetch).catch(() => {});
    expect(pendingEmail("https://elsewhere.example/")).toBeNull();
  });
});
