import { describe, expect, it } from "vitest";
import { toTablePrefix, validateToolName } from "../src/tool-name";

describe("validateToolName", () => {
  it("accepts normal names", () => {
    expect(validateToolName("visit-memo")).toBeNull();
    expect(validateToolName("abc")).toBeNull();
    expect(validateToolName("a1-b2-c3")).toBeNull();
  });
  it("rejects bad shapes", () => {
    expect(validateToolName("ab")).not.toBeNull();
    expect(validateToolName("-abc")).not.toBeNull();
    expect(validateToolName("abc-")).not.toBeNull();
    expect(validateToolName("Abc")).not.toBeNull();
    expect(validateToolName("a_b_c")).not.toBeNull();
    expect(validateToolName("a--b")).not.toBeNull();
    expect(validateToolName("a".repeat(33))).not.toBeNull();
  });
  it("rejects reserved names", () => {
    expect(validateToolName("api")).not.toBeNull();
    expect(validateToolName("_next")).not.toBeNull();
    expect(validateToolName("tools")).not.toBeNull();
  });
});

describe("toTablePrefix", () => {
  it("converts hyphens", () => {
    expect(toTablePrefix("visit-memo")).toBe("visit_memo_");
    expect(toTablePrefix("abc")).toBe("abc_");
  });
});
