import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["shared/tests/**/*.test.ts", "cp/tests/**/*.test.ts"],
  },
});
