import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      // Count untested files too, so a 0%-covered module can't hide from the gate.
      all: true,
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        "src/**/*.d.ts",
        // Phaser scene shells (WebGL/canvas) — pure logic is extracted to
        // movement/wang/pathfind and tested there; the shells need a browser.
        "src/client/phaser/world.ts",
        "src/client/phaser/board.ts",
        // Cosmetic FX (COSMETIC-FX guard) — never read by game logic.
        "src/client/phaser/fx.ts",
        "src/client/phaser/portrait.ts",
        // Phaser boot wrapper.
        "src/client/phaser/index.ts",
      ],
      // Branches sit at 85 (defensive paths); raise to 90 after B6 extraction.
      thresholds: { statements: 90, lines: 90, functions: 90, branches: 85 },
    },
  },
});
