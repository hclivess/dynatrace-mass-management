import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vitest/config";
import preact from "@preact/preset-vite";
import pkg from "./package.json" with { type: "json" };

/**
 * Everything goes into index.html: one classic inline script (styles included) and the icon as a
 * data URI. Browsers refuse module scripts and cross-file loads on pages opened from disk, and
 * Windows opens index.html from a zip without the rest of the folder; a single self-contained file
 * works there, from any web server, and on GitHub Pages alike. The Content-Security-Policy allows
 * exactly that script by its SHA-256 hash, and nothing else inline.
 */
function singleFile(): Plugin {
  return {
    name: "dmm-single-file",
    apply: "build",
    enforce: "post",
    generateBundle(_options, bundle) {
      const html = bundle["index.html"];
      if (!html || html.type !== "asset") throw new Error("index.html missing from the bundle");
      let page = String(html.source);
      for (const [name, chunk] of Object.entries(bundle)) {
        if (chunk.type !== "chunk") continue;
        const code = chunk.code.replace(/<\/script/gi, "<\\/script");
        const hash = createHash("sha256").update(code).digest("base64");
        page = page
          // Inline scripts cannot be deferred, so it goes last in <body>, after the element it mounts into.
          .replace(new RegExp(`\\s*<script[^>]*src="\\./${name}"[^>]*></script>`), "")
          .replace("</body>", () => `<script>${code}</script>\n  </body>`)
          .replace("script-src 'self'", `script-src 'sha256-${hash}'`);
        delete bundle[name];
        delete bundle[`${name}.map`];
      }
      const icon = readFileSync("public/icon.svg", "utf8");
      page = page.replace('href="./icon.svg"', `href="data:image/svg+xml,${encodeURIComponent(icon)}"`);
      if (/<script[^>]*src=/.test(page) || /<link[^>]*stylesheet/.test(page)) throw new Error("index.html still loads another file");
      html.source = page;
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [preact(), singleFile()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  build: {
    target: "es2022",
    modulePreload: false,
    copyPublicDir: false,
    rollupOptions: { output: { format: "iife", inlineDynamicImports: true } },
  },
  test: { environment: "node", include: ["tests/**/*.test.ts"] },
});
