# Website verification

Verified locally on 3 November 2026 with Node 22.23.4. This report concerns the isolated website; the extension's suite was not rerun because its implementation and dependency manifests are unchanged.

## Checks run

| Check | Result |
| --- | --- |
| Clean locked installation, npm ci | Passed |
| Strict TypeScript | Passed |
| ESLint, including React Hooks | Passed |
| Vitest | 14 tests passed |
| Production Vite build | Passed |
| Configured production-origin build | Canonical, OG, Twitter, robots and sitemap passed |
| Playwright Chromium | 12 tests passed |
| axe accessibility | No WCAG A/AA or best-practice violations in tested default views |
| Responsive widths | 320, 375, 768, 1024 and 1440 px; no horizontal overflow |
| Keyboard | Skip link, navigation dismissal, graph selection/movement, zoom/reset and showcase tabs passed |
| Reduced motion | Smooth scrolling disabled; sample edge animation suppressed |
| Graph interactions | Scenarios, branch/edge inspection, sample commits, analysis, drag, pan, zoom, fit/reset passed |
| Sample PR workflow | Editable title/description, local preview and return to edit passed |
| CSP compatibility | Interactions passed with the Netlify-configured policy applied to the document |
| External requests during demos | Zero observed |
| Shipped dependency audit | Zero vulnerabilities reported by npm audit --omit=dev |
| Local links/assets | All anchor targets, favicon, brand SVG, social PNG and robots passed |
| External product links | Repository, issues and maintainer URLs returned HTTP 200 after redirects |
| Whitespace check | git diff --check passed |

Desktop feature and showcase sections, the hero, and the mobile branch/inspector layout were also reviewed in Chromium screenshots. The graph is split into a separate approximately 64 kB gzipped JavaScript chunk; the initial application JavaScript is approximately 108 kB gzipped.

## Lighthouse

Local production preview, Lighthouse 13.6.0, headless Chromium, default mobile simulation and desktop preset.

| Profile | Performance | Accessibility | Best Practices | SEO |
| --- | --- | --- | --- | --- |
| mobile | 100 | 100 | 100 | 100 |
| desktop | 100 | 100 | 100 | 100 |

Measured audit details:

```json
[
  {
    "profile": "mobile",
    "version": "13.6.0",
    "time": "2026-11-03T09:57:05.523Z",
    "formFactor": "mobile",
    "scores": {
      "performance": 100,
      "accessibility": 100,
      "best-practices": 100,
      "seo": 100
    },
    "metrics": {
      "first-contentful-paint": "0.8 s",
      "largest-contentful-paint": "0.8 s",
      "total-blocking-time": "0 ms",
      "cumulative-layout-shift": "0.032"
    }
  },
  {
    "profile": "desktop",
    "version": "13.6.0",
    "time": "2026-11-03T09:56:42.013Z",
    "formFactor": "desktop",
    "scores": {
      "performance": 100,
      "accessibility": 100,
      "best-practices": 100,
      "seo": 100
    },
    "metrics": {
      "first-contentful-paint": "0.2 s",
      "largest-contentful-paint": "0.2 s",
      "total-blocking-time": "0 ms",
      "cumulative-layout-shift": "0.005"
    }
  }
]
```

These are local measurements, not production guarantees or an accessibility certification. Lighthouse's additional agentic-browsing category is outside the requested four-category target. Its optional manifests were not added.

## Deployment readiness and limits

- Root netlify.toml selects apps/website, Node 22, a locked installation, and dist output. It includes asset caching and CSP/security headers, with no SPA fallback or server functions. The browser test checks policy compatibility; actual hosted response headers still require verification after deployment.
- Netlify's production URL or VITE_SITE_URL supplies the canonical origin. The isolated SEO test uses a reserved .invalid test origin and removes its temporary output. The normal local build has no invented domain or sitemap. Configure the actual URL and rebuild for launch.
- Product and issue links now point directly to axvrma/prism. The previous local Lighthouse measurements predate this URL update. No remote or repository settings were changed.
- The MIT license was confirmed from the local product LICENSE. Font notices ship with the static output.
- Product representations and evidence are explicitly labeled conceptual/sample. No live Azure repository was accessed.
- No deployment, site registration, publication, domain changes, PR creation, or other external write was performed.
- Safari, Firefox, physical touch devices, real Azure credentials and hosted Netlify behavior were not tested. All browser checks used Chromium and viewport emulation.
- The pre-existing root .DS_Store modification was left untouched.

Run npm run verify to reproduce the code checks. See README.md for setup and launch instructions.
