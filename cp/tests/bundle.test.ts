import { describe, expect, it } from "vitest";
import { bundleEntries, createBundleZip, imageTagFor, listBundleZip, mergeBundleTools } from "../src/services/bundle";

const a = { name: "a-tool", files: [{ path: "page.tsx", content: "a" }, { path: "migrations/0001_init.sql", content: "x" }] };
const b = { name: "b-tool", files: [{ path: "page.tsx", content: Buffer.from("b").toString("base64"), encoding: "base64" as const }] };

describe("bundleEntries / createBundleZip", () => {
  it("puts every tool under app/app/tools/<name>/", () => {
    const entries = bundleEntries([b, a]);
    expect(Object.keys(entries).sort()).toEqual([
      "app/app/tools/a-tool/migrations/0001_init.sql",
      "app/app/tools/a-tool/page.tsx",
      "app/app/tools/b-tool/page.tsx",
    ]);
    expect(Buffer.from(entries["app/app/tools/b-tool/page.tsx"]).toString()).toBe("b");
  });
  it("round-trips through zip", () => {
    const zip = createBundleZip([a, b]);
    expect(listBundleZip(zip)).toEqual([
      "app/app/tools/a-tool/migrations/0001_init.sql",
      "app/app/tools/a-tool/page.tsx",
      "app/app/tools/b-tool/page.tsx",
    ]);
  });
  it("makes an empty zip when there are no tools", () => {
    expect(listBundleZip(createBundleZip([]))).toEqual([]);
  });
});

describe("mergeBundleTools", () => {
  const live = [a, b];
  const base = { id: 9, createdBy: "x", reason: "upload" };
  it("replaces the released tool's files", () => {
    const merged = mergeBundleTools(live, { ...base, op: "replace", toolName: "a-tool", files: [{ path: "page.tsx", content: "new" }] });
    expect(merged.map((t) => t.name).sort()).toEqual(["a-tool", "b-tool"]);
    expect(merged.find((t) => t.name === "a-tool")?.files).toEqual([{ path: "page.tsx", content: "new" }]);
  });
  it("adds a tool that is not live yet", () => {
    const merged = mergeBundleTools(live, { ...base, op: "replace", toolName: "c-tool", files: [{ path: "page.tsx", content: "c" }] });
    expect(merged.map((t) => t.name).sort()).toEqual(["a-tool", "b-tool", "c-tool"]);
  });
  it("drops the removed tool", () => {
    const merged = mergeBundleTools(live, { ...base, op: "remove", toolName: "a-tool" });
    expect(merged.map((t) => t.name)).toEqual(["b-tool"]);
  });
  it("keeps everything for reconcile", () => {
    expect(mergeBundleTools(live, { ...base, op: "reconcile" })).toEqual(live);
  });
});

describe("imageTagFor", () => {
  it("sanitizes the ref", () => {
    expect(imageTagFor(12, "main")).toBe("12-main");
    expect(imageTagFor(12, "refs/tags/v1.0")).toBe("12-refs-tags-v1.0");
    expect(imageTagFor(3, "")).toBe("3-ref");
  });
});
