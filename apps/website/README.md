# Prism website

The standalone marketing website for Prism, an Azure DevOps extension for VS Code. React, TypeScript, Vite, Tailwind CSS, Motion, Lucide, and React Flow. Static output only; no backend, tokens, Azure calls, analytics, external font requests, or paid services.

The website lives in `apps/website`, with its own dependency lockfile, TypeScript configuration, lint rules, and tests. Website builds and tests are independent of the extension's tooling. The root `.vscodeignore` excludes the website from extension packages.

## Local development

Use **Node 22.12 or newer within Node 22** (see `.nvmrc`). The extension and website install independently.

```sh
cd apps/website
nvm use
npm ci
npm run dev
```

Open `http://127.0.0.1:5173`. If you do not use nvm, select Node 22 with your preferred version manager.

```sh
npm run build
npm run preview
```

The production output is `apps/website/dist`, served at `http://127.0.0.1:4173` by preview. It can be served by any static HTTP host. No SPA rewrite or Netlify Functions are needed.

## Commands and verification

| Command | Purpose |
| --- | --- |
| `npm run typecheck` | Strict TypeScript checks for source, build configuration, and tests |
| `npm run lint` | ESLint and React Hooks checks |
| `npm test` | Vitest: graph topology, evidence semantics, drift propagation, and canonical configuration |
| `npm run build` | TypeScript checks and production compilation |
| `npm run test:browser` | Playwright tests against the production build |
| `npm run test:seo` | Isolated configured-origin build: canonical/social URLs, sitemap, and robots |
| `npm run verify` | Lint, unit tests, build, SEO build check, and browser tests |
| `npm audit --omit=dev` | Audit shipped dependencies |

Install the test browser before the first browser test:

```sh
npx playwright install chromium
npm run verify
```

Linux CI uses `npx playwright install --with-deps chromium`. Browser tests start and stop their own production preview unless port 4173 already serves an existing one. Do not run against a stale production build. Playwright's HTML report is in `playwright-report`; failed tests retain traces in `test-results`. Both are ignored by Git.

Browser coverage includes desktop graph scenarios, branch/edge selection, analysis, zoom, fit/reset, keyboard controls, accessible relationship summary, editable PR preview, mobile navigation, reduced motion, local asset/anchor checks, and responsive layout plus axe WCAG A/AA scans at **320, 375, 768, 1024, and 1440 pixels**. An automated scan supplements manual review; it does not certify accessibility.

The path-filtered `.github/workflows/website.yml` performs these checks independently of extension CI. See [VERIFICATION.md](VERIFICATION.md) for implementation-run results and limitations.

## Interactive demo

All repository names, branches, SHAs, commit messages, PRs, conflicts, and results are fictional sample data. No request is sent to Azure DevOps or an AI provider. Local state lasts for the current page visit only.

- **Healthy Flow:** illustrative source ancestry is verified across the sample release train.
- **Conflict Detected:** simulated conflict evidence, pending work, a sample active PR, and an inconclusive relationship illustrate different statuses.
- **Release Drift:** changed sample heads invalidate prior evidence. Downstream evidence is stale. Running sample analysis animates the demonstration; it does not fabricate new verification or clear drift.
- Select or drag a branch; select an edge to inspect its evidence, illustrative commits, and recommended next step.
- Pan by dragging empty canvas; pinch to zoom, or use the labeled zoom/fit controls. Normal scrolling continues down the website.
- Keyboard: Tab through branches and edges; Enter/Space selects, arrow keys move a branch. Reset restores original positions, scenario, selection, and viewport.
- On phones, a tappable branch list replaces the canvas. The inspector and expandable text relationship summary expose all essential information.
- The PR Creator showcase lets visitors edit sample fields and preview their changes locally. It never submits a PR.

The VS Code showcase is explicitly labeled **Conceptual interface**, based on documented product capabilities. It is not a product screenshot. The source checkout contains no suitable authentic screenshot.

Product language follows the extension README and `docs/branch-flow/semantics-and-format.md`: missing evidence is inconclusive; PR existence does not prove mergeability; stale evidence does not guarantee an outcome; there is no automatic push, merge, remote rebase, or conflict resolution. Optional AI-assisted PR generation in the actual extension sends selected context to the chosen provider.

## Design system and architecture

Dark surfaces (`#09090f`, `#111119`), thin borders, self-hosted Geist and Geist Mono, geometric SVG branding, restrained purple/cyan accents, text labels alongside status colors, and visible keyboard focus states. Layouts adapt at 480, 768, 1024, 1200, and 1440 pixels. Motion honors the device's reduced-motion preference; content remains visible before scroll animation. There are no continuous decorative animations.

```text
apps/website/
├── public/
│   ├── favicon.svg
│   ├── prism-logo.svg
│   ├── og-image.png
│   └── fonts/                 # Distributed font license notices
├── scripts/
│   ├── seo.ts                 # Validated canonical/OG URLs, robots, sitemap
│   └── social-image.mjs        # Reproducible original SVG → PNG social card
├── src/
│   ├── components/
│   │   ├── graph/             # Lazy canvas, custom node, recovery boundary
│   │   ├── sections/          # Feature cards, conceptual editor/PR demo
│   │   └── ui/                # Brand and reduced-motion-aware entrance
│   ├── data/demoGraph.ts      # Three scenarios and evidence semantics
│   ├── lib/constants.ts      # Repository, issue, and navigation destinations
│   ├── styles/global.css     # Tailwind entry, visual system, breakpoints
│   ├── App.tsx
│   └── main.tsx
├── tests/                     # Unit and Playwright tests
├── package-lock.json
└── README.md
```

The graph and its CSS are split from the initial application bundle. Fonts are self-hosted through Fontsource, with `font-display: swap`. Feature illustrations and branding are SVG/HTML/CSS. There are no large photographic assets. The checked-in 1200×630 social image can be regenerated with `node scripts/social-image.mjs`.

## SEO and deployment URL

The page includes title, description, Open Graph and Twitter card metadata, SVG favicon, semantic landmarks and headings, a skip link, and a no-JavaScript product summary. This is a client-rendered static application.

Set `VITE_SITE_URL` to the actual HTTPS production **origin** (no path, query, fragment, or credentials). The build also accepts Netlify's production `URL` automatically. A custom domain can be supplied as `VITE_SITE_URL` once configured. For local configuration, copy `.env.example` to `.env.local`.

With a known production URL the build emits:

- Absolute canonical, `og:url`, and social image URLs in `dist/index.html`.
- `dist/sitemap.xml` containing the canonical home page.
- `dist/robots.txt` with the sitemap URL.

When the production URL is unknown, the build omits canonical and `og:url`, uses a relative preview image URL, and emits robots without a sitemap reference. It intentionally does not invent a domain or emit an invalid sitemap. **Configure a real URL and rebuild before launch.** Environment values are public build-time settings, not secrets. Never add Azure or AI credentials to the website.

## Netlify deployment preparation

No deployment, site registration, publishing, domain change, repository rename, or external write is part of this implementation.

When you choose to deploy, import the repository into Netlify using the root `netlify.toml`:

| Setting | Value |
| --- | --- |
| Base directory | `apps/website` |
| Node | `22` |
| Build command | `npm ci && npm run build` |
| Publish directory | `dist` (relative to base) |
| Production origin | Automatic Netlify `URL`, or explicit `VITE_SITE_URL` |

The lockfile makes installation reproducible. Netlify may install dependencies before the build command; the explicit `npm ci` ensures the final build uses the checked-in lockfile. No root extension build runs.

The configuration provides immutable caching for fingerprinted `/assets/*`, revalidation for the HTML home page, and security headers. The Content Security Policy permits inline **styles** for React Flow's positioning and Motion's transforms while scripts, fonts, and network connections remain same-origin. No routing fallback is configured because this site has only one page with anchor navigation.

A manual upload must contain the **built `dist` contents**, not the source directory. Dashboard/manual workflows must apply the equivalent headers if they bypass `netlify.toml`.

After deployment, verify the canonical origin and social preview using the real public URL, inspect the security/cache headers, and run Lighthouse on the deployed site. Local scores do not guarantee production results.

## Links and licenses

All primary product links deliberately use the requested URL: [axvrma/azure-devops-pr-helper](https://github.com/axvrma/azure-devops-pr-helper). During verification, GitHub redirected this URL and its issues path to `axvrma/prism`. The supplied URLs remain in the website; no repository settings or remotes were changed.

The parent project's [MIT license](../../LICENSE) applies. Geist fonts use SIL Open Font License 1.1; the full notices ship in `public/fonts`. Dependencies retain their own licenses. React Flow attribution remains visible. There are no invented adoption metrics, testimonials, Marketplace links, or security guarantees.

Implementation references: [React Flow accessibility](https://reactflow.dev/learn/advanced-use/accessibility), [Vite static deployment](https://vite.dev/guide/static-deploy).
