import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
const output = mkdtempSync(join(tmpdir(), "prism-seo-check-"));
const origin = "https://prism-verification.invalid";
try {
  const result = spawnSync(
    process.execPath,
    [
      "node_modules/vite/bin/vite.js",
      "build",
      "--outDir",
      output,
      "--emptyOutDir",
    ],
    { env: { ...process.env, VITE_SITE_URL: origin }, encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const html = readFileSync(join(output, "index.html"), "utf8");
  assert.match(html, new RegExp(`rel="canonical" href="${origin}/"`));
  assert.ok(html.includes(`property="og:url" content="${origin}/"`));
  assert.ok(
    html.includes(`property="og:image" content="${origin}/og-image.png"`),
  );
  assert.ok(
    html.includes(`name="twitter:image" content="${origin}/og-image.png"`),
  );
  assert.ok(
    readFileSync(join(output, "robots.txt"), "utf8").includes(
      `Sitemap: ${origin}/sitemap.xml`,
    ),
  );
  assert.ok(
    readFileSync(join(output, "sitemap.xml"), "utf8").includes(
      `<loc>${origin}/</loc>`,
    ),
  );
  console.log(
    "Configured production canonical, social image URLs, robots, and sitemap verified in an isolated build.",
  );
} finally {
  rmSync(output, { recursive: true, force: true });
}
