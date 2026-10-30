import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Only the issuer-resolution messages are tested here. The rest of auth.ts is
 * delegation to the Inrupt library and a redirect — a unit test would assert
 * the mock. That part is covered by docs/manual-tests.md against a real
 * provider.
 *
 * These messages are worth pinning because they are what a user sees when
 * sign-in fails, and the default ("Failed to fetch") tells them nothing.
 */
vi.mock("@inrupt/solid-client-authn-browser", () => ({
  Session: class {
    info = { sessionId: "test" };
    async handleIncomingRedirect() {
      return undefined;
    }
    async login() {}
    async logout() {}
    async fetch() {
      return new Response();
    }
  },
}));

const mockGetSolidDataset = vi.fn();
const mockGetThing = vi.fn();
const mockGetUrl = vi.fn();
vi.mock("@inrupt/solid-client", () => ({
  getSolidDataset: (...a: unknown[]) => mockGetSolidDataset(...a),
  getThing: (...a: unknown[]) => mockGetThing(...a),
  getUrl: (...a: unknown[]) => mockGetUrl(...a),
}));

const { discoverOidcIssuer, redirectUrlFrom } = await import("./auth");

beforeEach(() => {
  mockGetSolidDataset.mockReset();
  mockGetThing.mockReset();
  mockGetUrl.mockReset();
});

describe("discoverOidcIssuer", () => {
  const WEBID = "https://pod.example/alice/profile/card#me";

  it("returns the declared issuer", async () => {
    mockGetSolidDataset.mockResolvedValue({});
    mockGetThing.mockReturnValue({});
    mockGetUrl.mockReturnValue("https://pod.example/");

    expect(await discoverOidcIssuer(WEBID)).toBe("https://pod.example/");
    // The fragment is stripped: profile documents are fetched, not fragments.
    expect(mockGetSolidDataset).toHaveBeenCalledWith(
      "https://pod.example/alice/profile/card"
    );
  });

  it("names the address when the profile cannot be reached", async () => {
    // The raw browser error is "Failed to fetch", which gives the user nothing
    // to act on.
    mockGetSolidDataset.mockRejectedValue(new TypeError("Failed to fetch"));

    const message = await discoverOidcIssuer(WEBID).catch((e: Error) => e.message);

    expect(message).toContain("https://pod.example/alice/profile/card");
    expect(message).toMatch(/could not reach/i);
  });

  it("explains a document that does not describe the WebID", async () => {
    mockGetSolidDataset.mockResolvedValue({});
    mockGetThing.mockReturnValue(null);

    const message = await discoverOidcIssuer(WEBID).catch((e: Error) => e.message);

    expect(message).toMatch(/does not describe/i);
  });

  it("explains a profile with no solid:oidcIssuer, and suggests the pod address", async () => {
    mockGetSolidDataset.mockResolvedValue({});
    mockGetThing.mockReturnValue({});
    mockGetUrl.mockReturnValue(null);

    const message = await discoverOidcIssuer(WEBID).catch((e: Error) => e.message);

    expect(message).toMatch(/no solid:oidcIssuer/i);
    expect(message).toMatch(/pod's address/i);
  });
});

describe("redirectUrlFrom", () => {
  it("drops the query string and the fragment, which OIDC refuses", () => {
    expect(redirectUrlFrom("http://localhost:5173/#/")).toBe("http://localhost:5173/");
    expect(redirectUrlFrom("https://app.example/x/?code=1&state=2#/c/abc")).toBe("https://app.example/x/");
  });
});
