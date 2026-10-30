import { describe, it, expect } from "vitest";
import { shortWebId } from "./identity";

describe("shortWebId", () => {
  it("strips scheme, host and the profile/card convention", () => {
    expect(shortWebId("https://pod.example.org/nicolas/profile/card#me")).toBe("nicolas");
  });

  it("keeps a deeper path intact, without the fragment", () => {
    expect(shortWebId("https://pod.example.org/nicolas_claude/agents/agent-pink2#me")).toBe(
      "nicolas_claude/agents/agent-pink2"
    );
  });

  it("falls back to the host when the identity lives at the pod root", () => {
    expect(shortWebId("https://nicolas.example.org/profile/card#me")).toBe("nicolas.example.org");
  });

  it("returns the input unchanged when it is not a URL", () => {
    expect(shortWebId("not-a-url")).toBe("not-a-url");
  });
});
