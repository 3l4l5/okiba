import { describe, expect, it } from "vitest";
import { validateUploadFiles, validateUploadPath } from "../src/upload-validation";

const page = { path: "page.tsx", content: "export default function Page() { return null }" };

describe("validateUploadPath", () => {
  it("accepts relative paths", () => {
    expect(validateUploadPath("page.tsx")).toBeNull();
    expect(validateUploadPath("migrations/0001_init.sql")).toBeNull();
    expect(validateUploadPath("components/Form.tsx")).toBeNull();
  });
  it("rejects traversal and absolute paths", () => {
    expect(validateUploadPath("../lib/db.ts")).not.toBeNull();
    expect(validateUploadPath("a/../../b.ts")).not.toBeNull();
    expect(validateUploadPath("/etc/passwd")).not.toBeNull();
    expect(validateUploadPath("a//b.ts")).not.toBeNull();
    expect(validateUploadPath("a\\b.ts")).not.toBeNull();
  });
  it("rejects platform files", () => {
    expect(validateUploadPath("package.json")).not.toBeNull();
    expect(validateUploadPath("sub/Package.json")).not.toBeNull();
    expect(validateUploadPath("next.config.ts")).not.toBeNull();
    expect(validateUploadPath("middleware.ts")).not.toBeNull();
    expect(validateUploadPath("Dockerfile")).not.toBeNull();
    expect(validateUploadPath(".env.local")).not.toBeNull();
    expect(validateUploadPath(".github/workflows/x.yml")).not.toBeNull();
    expect(validateUploadPath("node_modules/x/index.js")).not.toBeNull();
  });
});

describe("validateUploadFiles", () => {
  it("accepts a minimal tool", () => {
    const result = validateUploadFiles([page, { path: "actions.ts", content: "'use server'" }]);
    expect(result.errors).toEqual([]);
  });
  it("requires page.tsx", () => {
    const result = validateUploadFiles([{ path: "actions.ts", content: "x" }]);
    expect(result.errors.some((e) => e.includes("page.tsx"))).toBe(true);
  });
  it("rejects duplicates", () => {
    const result = validateUploadFiles([page, page]);
    expect(result.errors.some((e) => e.includes("重複"))).toBe(true);
  });
  it("rejects secret-like strings", () => {
    const result = validateUploadFiles([
      page,
      { path: "actions.ts", content: 'const key = "AKIAABCDEFGHIJKLMNOP";' },
    ]);
    expect(result.errors.some((e) => e.includes("AWS アクセスキー"))).toBe(true);
    const slack = validateUploadFiles([page, { path: "a.ts", content: "xoxb-1234567890-abcdef" }]);
    expect(slack.errors.some((e) => e.includes("Slack"))).toBe(true);
  });
  it("does not scan binary files for secrets", () => {
    const result = validateUploadFiles([
      page,
      { path: "logo.png", content: Buffer.from("AKIAABCDEFGHIJKLMNOP").toString("base64"), encoding: "base64" },
    ]);
    expect(result.errors).toEqual([]);
  });
  it("rejects oversized uploads", () => {
    const big = "x".repeat(5 * 1024 * 1024 + 1);
    const result = validateUploadFiles([page, { path: "big.txt", content: big }]);
    expect(result.errors.some((e) => e.includes("合計サイズ"))).toBe(true);
  });
});
