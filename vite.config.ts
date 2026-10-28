import { defineConfig } from "vitest/config";
import preact from "@preact/preset-vite";
import pkg from "./package.json" with { type: "json" };

export default defineConfig({
  // Relative asset paths: the same build works on GitHub Pages, from a zip, or behind any prefix.
  base: "./",
  plugins: [preact()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  build: { target: "es2022", sourcemap: true },
  test: { environment: "node", include: ["tests/**/*.test.ts"] },
});
