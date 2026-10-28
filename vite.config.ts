import { defineConfig, type Plugin } from "vitest/config";
import preact from "@preact/preset-vite";
import pkg from "./package.json" with { type: "json" };

/**
 * Browsers refuse module scripts and crossorigin requests on pages opened from disk (file://), so
 * the release zip would open to a blank page. One classic script with no crossorigin attribute
 * runs anywhere: GitHub Pages, any web server, or a double-clicked index.html.
 */
function classicScript(): Plugin {
  return {
    name: "dmm-classic-script",
    apply: "build",
    enforce: "post",
    transformIndexHtml(html) {
      return html
        .replace(/<script type="module" crossorigin src="([^"]+)"><\/script>/, '<script defer src="$1"></script>')
        .replace(/ crossorigin(?=[\s>])/g, "");
    },
  };
}

export default defineConfig({
  // Relative asset paths: the same build works on GitHub Pages, from a zip, or behind any prefix.
  base: "./",
  plugins: [preact(), classicScript()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  build: {
    target: "es2022",
    sourcemap: true,
    modulePreload: false,
    rollupOptions: { output: { format: "iife", inlineDynamicImports: true } },
  },
  test: { environment: "node", include: ["tests/**/*.test.ts"] },
});
