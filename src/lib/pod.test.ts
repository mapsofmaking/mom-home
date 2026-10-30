import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * `auth.ts` constructs a Session at module load, which needs a real browser.
 * Mock it: these tests are about pod.ts's own logic, and the fetch it uses is
 * exactly the thing we want to control.
 */
const mockFetch = vi.fn();
vi.mock("./auth", () => ({ authFetch: (...args: unknown[]) => mockFetch(...args) }));

const mockGetPodUrlAll = vi.fn();
vi.mock("@inrupt/solid-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@inrupt/solid-client")>();
  return { ...actual, getPodUrlAll: (...args: unknown[]) => mockGetPodUrlAll(...args) };
});

const {
  advertisesStorageType,
  findStorageByLinkHeaders,
  getPrimaryPodUrl,
  isAuthError,
  describePodError,
  slugify,
  isoDate,
} = await import("./pod");
const { FetchError } = await import("@inrupt/solid-client");

const STORAGE = "http://www.w3.org/ns/pim/space#Storage";

/** A HEAD response carrying the given Link header. */
function headResponse(link: string | null, ok = true): Response {
  return {
    ok,
    headers: { get: (name: string) => (name.toLowerCase() === "link" ? link : null) },
  } as unknown as Response;
}

/**
 * A FetchError shaped the way solid-client actually throws them — the message
 * carries the URL in brackets, which is what describePodError digs out.
 */
function podFetchError(status: number, url: string): InstanceType<typeof FetchError> {
  const response = new Response(null, { status, statusText: "error" });
  Object.defineProperty(response, "url", { value: url });
  return new FetchError(
    `Fetching the Resource failed at [${url}]`,
    response as Response & { ok: false }
  );
}

beforeEach(() => {
  mockFetch.mockReset();
  mockGetPodUrlAll.mockReset();
});

describe("advertisesStorageType", () => {
  it("matches the header a Solid server actually sends", () => {
    expect(advertisesStorageType(`<${STORAGE}>; rel="type"`)).toBe(true);
  });

  it("finds the storage entry among several comma-separated links", () => {
    const header = [
      `<http://www.w3.org/ns/ldp#Container>; rel="type"`,
      `<http://www.w3.org/ns/ldp#BasicContainer>; rel="type"`,
      `<${STORAGE}>; rel="type"`,
      `<.acl>; rel="acl"`,
    ].join(", ");
    expect(advertisesStorageType(header)).toBe(true);
  });

  it("accepts an unquoted rel", () => {
    expect(advertisesStorageType(`<${STORAGE}>; rel=type`)).toBe(true);
  });

  it("rejects the storage URI under a different rel", () => {
    // A describedby pointing at the storage type is not a type declaration.
    expect(advertisesStorageType(`<${STORAGE}>; rel="describedby"`)).toBe(false);
  });

  it("rejects other types declared with rel=type", () => {
    expect(
      advertisesStorageType(`<http://www.w3.org/ns/ldp#Container>; rel="type"`)
    ).toBe(false);
  });

  it("is false for a missing header", () => {
    expect(advertisesStorageType(null)).toBe(false);
  });
});

describe("findStorageByLinkHeaders", () => {
  it("STOPS at the first ancestor that advertises storage", async () => {
    // A multi-pod server advertises pim:Storage on its own root too. Walking
    // past the user's pod yields the server root: wrong, and not writable.
    mockFetch.mockImplementation(async (url: string) => {
      if (url === "https://pod.example/alice/" || url === "https://pod.example/") {
        return headResponse(`<${STORAGE}>; rel="type"`);
      }
      return headResponse(null);
    });

    const found = await findStorageByLinkHeaders(
      "https://pod.example/alice/profile/card"
    );
    expect(found).toBe("https://pod.example/alice/");
  });

  it("strips the fragment and query before building the ladder", async () => {
    const seen: string[] = [];
    mockFetch.mockImplementation(async (url: string) => {
      seen.push(url);
      return headResponse(null);
    });

    await findStorageByLinkHeaders("https://pod.example/alice/profile/card?x=1#me");

    expect(seen).toEqual([
      "https://pod.example/alice/profile/card",
      "https://pod.example/alice/profile/",
      "https://pod.example/alice/",
      "https://pod.example/",
    ]);
  });

  it("keeps walking past an unreachable ancestor", async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url === "https://pod.example/alice/profile/") throw new Error("network");
      if (url === "https://pod.example/alice/") {
        return headResponse(`<${STORAGE}>; rel="type"`);
      }
      return headResponse(null);
    });

    expect(
      await findStorageByLinkHeaders("https://pod.example/alice/profile/card")
    ).toBe("https://pod.example/alice/");
  });

  it("ignores a storage header on a non-ok response", async () => {
    mockFetch.mockResolvedValue(headResponse(`<${STORAGE}>; rel="type"`, false));
    expect(await findStorageByLinkHeaders("https://pod.example/alice/card")).toBeNull();
  });

  it("returns null when nothing advertises storage", async () => {
    mockFetch.mockResolvedValue(headResponse(null));
    expect(await findStorageByLinkHeaders("https://pod.example/alice/card")).toBeNull();
  });
});

describe("getPrimaryPodUrl", () => {
  it("prefers the pim:storage triple, without any HEAD requests", async () => {
    mockGetPodUrlAll.mockResolvedValue(["https://pod.example/alice/"]);

    expect(await getPrimaryPodUrl("https://pod.example/alice/profile/card#me")).toBe(
      "https://pod.example/alice/"
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("falls back to the header walk when the profile is unreadable", async () => {
    mockGetPodUrlAll.mockRejectedValue(new Error("profile unreachable"));
    mockFetch.mockImplementation(async (url: string) =>
      url === "https://pod.example/alice/"
        ? headResponse(`<${STORAGE}>; rel="type"`)
        : headResponse(null)
    );

    expect(await getPrimaryPodUrl("https://pod.example/alice/profile/card#me")).toBe(
      "https://pod.example/alice/"
    );
  });

  it("falls back when the profile declares no storage", async () => {
    mockGetPodUrlAll.mockResolvedValue([]);
    mockFetch.mockImplementation(async (url: string) =>
      url === "https://pod.example/alice/"
        ? headResponse(`<${STORAGE}>; rel="type"`)
        : headResponse(null)
    );

    expect(await getPrimaryPodUrl("https://pod.example/alice/profile/card#me")).toBe(
      "https://pod.example/alice/"
    );
  });

  it("throws a diagnosable error when both tiers fail", async () => {
    mockGetPodUrlAll.mockResolvedValue([]);
    mockFetch.mockResolvedValue(headResponse(null));

    await expect(
      getPrimaryPodUrl("https://pod.example/alice/profile/card#me")
    ).rejects.toThrow(/pim:storage/);
  });
});

describe("isAuthError", () => {
  const fetchError = (status: number) => podFetchError(status, "https://pod.example/x");

  it("is true for 401 and 403", () => {
    expect(isAuthError(fetchError(401))).toBe(true);
    expect(isAuthError(fetchError(403))).toBe(true);
  });

  it("is false for 404 — a missing resource is not an auth problem", () => {
    expect(isAuthError(fetchError(404))).toBe(false);
  });

  it("is false for anything that is not a FetchError", () => {
    expect(isAuthError(new Error("boom"))).toBe(false);
    expect(isAuthError("boom")).toBe(false);
    expect(isAuthError(undefined)).toBe(false);
  });
});

describe("describePodError", () => {
  const fetchError = (status: number) =>
    podFetchError(status, "https://pod.example/private/");

  it("names the resource and blames the session on 401", () => {
    const msg = describePodError(fetchError(401));
    expect(msg).toContain("https://pod.example/private/");
    expect(msg).toMatch(/expired/i);
  });

  it("reports other failures without claiming they are auth", () => {
    const msg = describePodError(fetchError(500));
    expect(msg).toContain("500");
    expect(msg).not.toMatch(/expired/i);
  });

  it("passes through a plain Error's message", () => {
    expect(describePodError(new Error("no network"))).toBe("no network");
  });
});

describe("slugify", () => {
  it("folds accents rather than dropping the letters", () => {
    // Dropping them would give "chauffement" — a different word.
    expect(slugify("Échauffement quotidien")).toBe("echauffement-quotidien");
  });

  it("collapses punctuation and trims leading/trailing dashes", () => {
    expect(slugify("  Séance #1 — matin!  ")).toBe("seance-1-matin");
  });

  it("returns the fallback when nothing survives", () => {
    expect(slugify("!!!")).toBe("item");
    expect(slugify("!!!", "carnet")).toBe("carnet");
  });
});

describe("isoDate", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses the LOCAL day, not the UTC one", () => {
    // 22:30 in Brussels on 1 June is 20:30 UTC the same day — but at 01:30
    // local on 2 June it is still 23:30 UTC on 1 June. A toISOString()-based
    // implementation reports the wrong day for the user.
    const lateEvening = new Date(2026, 5, 1, 23, 30, 0);
    expect(isoDate(lateEvening)).toBe("2026-06-01");

    const justAfterMidnight = new Date(2026, 5, 2, 0, 30, 0);
    expect(isoDate(justAfterMidnight)).toBe("2026-06-02");
  });

  it("pads single-digit months and days", () => {
    expect(isoDate(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});
