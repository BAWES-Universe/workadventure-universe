import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        include: ["tests/**/*.test.ts", "mcp/__tests__/**/*.test.ts"],
        environment: "node",
    },
});
