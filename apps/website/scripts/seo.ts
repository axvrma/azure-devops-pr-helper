import type { Plugin } from "vite";
export function productionUrl(value?: string): string | undefined {
  if (!value?.trim()) return undefined;
  const url = new URL(value.trim());
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error(
      "VITE_SITE_URL must be an HTTPS origin, without credentials, a path, query, or fragment.",
    );
  return url.origin;
}
export function seoPlugin(value?: string): Plugin {
  const origin = productionUrl(value);
  return {
    name: "prism-seo",
    transformIndexHtml(html) {
      const image = `${origin || ""}/og-image.png`;
      const tags = `${origin ? `<link rel="canonical" href="${origin}/"/><meta property="og:url" content="${origin}/"/>` : ""}<meta property="og:image" content="${image}"/><meta name="twitter:image" content="${image}"/>`;
      return html.replace("<!-- site-metadata -->", tags);
    },
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "robots.txt",
        source: `User-agent: *\nAllow: /\n${origin ? `Sitemap: ${origin}/sitemap.xml\n` : ""}`,
      });
      if (origin)
        this.emitFile({
          type: "asset",
          fileName: "sitemap.xml",
          source: `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${origin}/</loc></url></urlset>`,
        });
    },
  };
}
