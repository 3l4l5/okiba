import { describe, expect, it } from "vitest";
import { generateToken, hashToken, looksLikeToken, TOKEN_PREFIX } from "../src/lib/token";

describe("upload token", () => {
  it("generates a prefixed random token and a sha256 hash", () => {
    const { raw, hash } = generateToken();
    expect(raw.startsWith(TOKEN_PREFIX)).toBe(true);
    expect(raw.length).toBeGreaterThan(40);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(raw)).toBe(hash);
  });
  it("generates different tokens each time", () => {
    expect(generateToken().raw).not.toBe(generateToken().raw);
  });
  it("recognizes the token shape", () => {
    expect(looksLikeToken(generateToken().raw)).toBe(true);
    expect(looksLikeToken("okt_short")).toBe(false);
    expect(looksLikeToken("Bearer x")).toBe(false);
  });
});
