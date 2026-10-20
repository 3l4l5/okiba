import { describe, expect, it } from "vitest";
import { buildPrompt } from "../src/services/prompts";

describe("buildPrompt", () => {
  const prompt = buildPrompt({
    toolName: "visit-memo",
    description: "顧客訪問メモ",
    token: "okt_testtoken",
    expiresAt: new Date("2026-10-21T00:00:00Z"),
    secretKeys: ["SLACK_TOKEN", "CRM_API_KEY"],
    cpUrl: "https://cp.example.com/",
    toolsUrl: "https://tools.example.com",
  });

  it("contains the tool URL, prefix, API endpoints and token", () => {
    expect(prompt).toContain("https://tools.example.com/tools/visit-memo");
    expect(prompt).toContain("`visit_memo_`");
    expect(prompt).toContain("https://cp.example.com/api/tools/visit-memo/files");
    expect(prompt).toContain("https://cp.example.com/api/tools/visit-memo/uploads");
    expect(prompt).toContain("okt_testtoken");
    expect(prompt).toContain("2026-10-21T00:00:00.000Z");
  });
  it("lists secret key names only", () => {
    expect(prompt).toContain("`SLACK_TOKEN`");
    expect(prompt).toContain("`CRM_API_KEY`");
  });
  it("says when no secrets are registered", () => {
    const empty = buildPrompt({
      toolName: "a-b",
      description: "x",
      token: "okt_x",
      expiresAt: new Date(),
      secretKeys: [],
      cpUrl: "http://localhost:3000",
      toolsUrl: "http://localhost:3001",
    });
    expect(empty).toContain("まだ登録されていません");
  });
});
