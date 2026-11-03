import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { domAnimation, LazyMotion, MotionConfig } from "motion/react";
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronRight,
  Code2,
  ExternalLink,
  FolderGit2,
  GitBranch,
  Github,
  GitPullRequest,
  Menu,
  Network,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import { DemoBoundary } from "./components/graph/DemoBoundary";
import { Brand, BrandMark } from "./components/ui/Brand";
import { Reveal } from "./components/ui/Reveal";
import { Features } from "./components/sections/Features";
import { Showcase } from "./components/sections/Showcase";
import { ISSUES, NAV, REPO } from "./lib/constants";
const GraphDemo = lazy(() => import("./components/graph/GraphDemo"));
function External({
  children,
  href = REPO,
  className = "",
}: {
  children: ReactNode;
  href?: string;
  className?: string;
}) {
  return (
    <a
      href={href}
      className={className}
      target="_blank"
      rel="noopener noreferrer"
    >
      {children}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}
function Header() {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const close = (e: KeyboardEvent) => {
      if (e.key === "Escape" && open) {
        setOpen(false);
        menuRef.current?.focus();
      }
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [open]);
  return (
    <header className="site-header">
      <div className="nav-inner container">
        <a href="#top" aria-label="Prism home">
          <Brand />
        </a>
        <nav aria-label="Main navigation" className="desktop-nav">
          {NAV.map((n) => (
            <a key={n.label} href={n.href}>
              {n.label}
            </a>
          ))}
        </nav>
        <External className="nav-cta">
          <Github size={15} /> View on GitHub <ArrowUpRight size={13} />
        </External>
        <button
          ref={menuRef}
          className="menu-toggle"
          aria-label={open ? "Close navigation" : "Open navigation"}
          aria-expanded={open}
          aria-controls="mobile-navigation"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <X /> : <Menu />}
        </button>
      </div>
      {open && (
        <nav
          id="mobile-navigation"
          className="mobile-nav"
          aria-label="Mobile navigation"
        >
          {NAV.map((n) => (
            <a key={n.label} href={n.href} onClick={() => setOpen(false)}>
              {n.label}
              <ArrowUpRight size={15} />
            </a>
          ))}
        </nav>
      )}
    </header>
  );
}
export function App() {
  return (
    <MotionConfig reducedMotion="user">
      <LazyMotion features={domAnimation}>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <div id="top" />
        <Header />
        <main id="main">
          <section className="hero container">
            <div className="hero-grid" aria-hidden="true" />
            <div className="hero-eyebrow">
              <span className="prism-tiny">
                <BrandMark />
              </span>{" "}
              INTRODUCING PRISM <span className="eyebrow-separator" /> FOR AZURE
              DEVOPS <ChevronRight size={12} />
            </div>
            <h1>
              Every branch.
              <br />
              <span>One clear picture.</span>
            </h1>
            <p className="hero-description">
              Visualize Git workflows, analyze branch relationships,
              <br className="desktop-break" /> spot integration risks, and plan
              pull requests—all from VS Code.
            </p>
            <div className="hero-actions">
              <External className="button button-primary">
                <Github size={17} /> Explore on GitHub{" "}
                <ArrowUpRight size={16} />
              </External>
              <a className="button button-secondary" href="#demo">
                See Prism in Action <ArrowDown size={16} />
              </a>
            </div>
            <p className="hero-support">
              Built for engineers who manage more than one branch.
            </p>
            <div className="hero-demo" id="demo">
              <div className="demo-intro">
                <span>
                  <span className="pulse-dot" /> YOUR WORKFLOW, IN FOCUS
                </span>
                <span>NOT ANOTHER TAB. A CLEARER PERSPECTIVE.</span>
              </div>
              <DemoBoundary>
                <Suspense
                  fallback={
                    <div className="demo-loading" role="status">
                      <GitBranch size={28} />
                      <span>Loading the sample branch canvas…</span>
                    </div>
                  }
                >
                  <GraphDemo />
                </Suspense>
              </DemoBoundary>
            </div>
            <div className="hero-footnote">
              <span>
                <Code2 size={14} /> Native to VS Code
              </span>
              <span>
                <FolderGit2 size={14} /> Built for Azure DevOps
              </span>
              <span>
                <Github size={14} /> Open source. MIT licensed.
              </span>
              <span>
                <ShieldCheck size={14} /> Explicit actions. Always.
              </span>
            </div>
          </section>
          <Features />
          <section className="section how-section container" id="how-it-works">
            <Reveal>
              <div className="section-eyebrow">
                <span>02 /</span> LESS MENTAL OVERHEAD
              </div>
              <div className="section-heading-row">
                <h2>
                  From complex to clear<span className="muted-period">.</span>
                </h2>
                <p>
                  Three steps to a shared understanding.
                  <br />
                  All inside your editor.
                </p>
              </div>
            </Reveal>
            <div className="steps">
              {[
                {
                  n: "01",
                  title: "Connect",
                  copy: "Configure your Azure DevOps organization, project, and repository within the VS Code extension.",
                  icon: FolderGit2,
                  visual: (
                    <>
                      <span className="connection-glyph">
                        <Code2 size={22} />
                      </span>
                      <span className="connection-dots">········</span>
                      <span className="connection-glyph azure-glyph">A</span>
                      <span className="connect-check">
                        <Check size={10} />
                      </span>
                    </>
                  ),
                },
                {
                  n: "02",
                  title: "Visualize",
                  copy: "Add branches and connect them to describe your integration relationships.",
                  icon: Network,
                  visual: (
                    <div className="step-branch">
                      <span>
                        <GitBranch size={12} /> main
                      </span>
                      <ArrowRight size={15} />
                      <span>
                        <GitBranch size={12} /> release
                      </span>
                    </div>
                  ),
                },
                {
                  n: "03",
                  title: "Analyze",
                  copy: "Inspect integration evidence, identify pending work, and prepare pull requests.",
                  icon: ShieldCheck,
                  visual: (
                    <div className="step-evidence">
                      <span>
                        <Check size={12} /> Ancestry verified
                      </span>
                      <span>
                        <GitPullRequest size={12} /> Next integration identified
                      </span>
                    </div>
                  ),
                },
              ].map((s) => (
                <Reveal key={s.n} className="step">
                  <div className="step-visual" aria-hidden="true">
                    {s.visual}
                  </div>
                  <div className="step-title">
                    <span>{s.n}</span>
                    <h3>{s.title}</h3>
                  </div>
                  <p>{s.copy}</p>
                </Reveal>
              ))}
            </div>
          </section>
          <Showcase />
          <section className="section credibility-section container">
            <Reveal className="credibility-layout">
              <div>
                <div className="section-eyebrow">
                  <span>04 /</span> ENGINEERED TO BE HONEST
                </div>
                <h2>
                  Smart analysis.
                  <br />
                  <span className="text-muted">No magic.</span>
                </h2>
                <p className="credibility-intro">
                  A green badge should mean something.
                  <br />
                  Prism shows what it knows—and when it doesn’t.
                </p>
                <External className="text-link">
                  Explore the source code <ArrowUpRight size={15} />
                </External>
                <div className="evidence-key">
                  <div>
                    <Check size={14} />
                    <span>Verified ancestry</span>
                    <code>SYNCED</code>
                  </div>
                  <div>
                    <span className="unknown-mark">?</span>
                    <span>Insufficient evidence</span>
                    <code>UNKNOWN</code>
                  </div>
                  <p>
                    Changed branch heads? Previous evidence becomes stale, not a
                    promise.
                  </p>
                </div>
              </div>
              <div className="principles">
                {[
                  {
                    icon: ShieldCheck,
                    title: "Evidence-based status",
                    copy: "Results are grounded in available Git and Azure DevOps evidence. Missing evidence can mean an inconclusive result.",
                  },
                  {
                    icon: FolderGit2,
                    title: "Local-first workflow",
                    copy: "Save graphs as .branchflow.json files in your workspace. Keep your branch plans close to your code.",
                  },
                  {
                    icon: GitPullRequest,
                    title: "Explicit actions",
                    copy: "No hidden pushes, merges, or rebases. Preparing a PR opens an editable workflow; only your submission creates it.",
                  },
                  {
                    icon: Sparkles,
                    title: "Optional AI",
                    copy: "Core branch analysis works without AI or a paid AI subscription. When enabled, PR generation sends selected context to your chosen provider.",
                  },
                ].map(({ icon: Icon, title, copy }) => (
                  <div className="principle" key={title}>
                    <span className="principle-icon">
                      <Icon size={19} />
                    </span>
                    <div>
                      <h3>{title}</h3>
                      <p>{copy}</p>
                    </div>
                  </div>
                ))}
              </div>
            </Reveal>
          </section>
          <section className="open-source-section container">
            <Reveal className="open-source-card">
              <div className="open-source-copy">
                <div className="section-eyebrow">
                  <Github size={16} /> OPEN SOURCE, OPEN POSSIBILITIES
                </div>
                <h2>
                  Built in the open<span className="muted-period">.</span>
                </h2>
                <p>
                  Explore the source, inspect the architecture, report issues,
                  <br className="desktop-break" /> and help shape the future of
                  Prism.
                </p>
                <div className="open-source-actions">
                  <External className="button button-secondary">
                    <Github size={16} /> View Repository{" "}
                    <ArrowUpRight size={14} />
                  </External>
                  <External href={ISSUES} className="text-link">
                    Report an Issue <ArrowUpRight size={14} />
                  </External>
                </div>
              </div>
              <div className="repository-card">
                <div>
                  <Github size={23} />
                  <span className="repo-public">Public</span>
                </div>
                <span className="repo-owner">axvrma /</span>
                <External className="repo-name">
                  prism <ExternalLink size={12} />
                </External>
                <p>
                  Visual branch integration planning
                  <br />
                  inside Visual Studio Code.
                </p>
                <div className="repo-meta">
                  <span>
                    <i /> VS Code Extension
                  </span>
                  <span>MIT License</span>
                </div>
              </div>
            </Reveal>
          </section>
          <section className="final-cta section container">
            <div className="cta-prism" aria-hidden="true">
              <BrandMark />
            </div>
            <Reveal>
              <span className="section-eyebrow">
                A LITTLE PERSPECTIVE CHANGES EVERYTHING
              </span>
              <h2>
                Your branches
                <br />
                deserve <span>clarity.</span>
              </h2>
              <p>
                Stop tracing integrations in your head.
                <br />
                See the whole picture with Prism.
              </p>
              <div className="hero-actions">
                <External className="button button-primary">
                  <Github size={17} /> Get Prism on GitHub{" "}
                  <ArrowUpRight size={16} />
                </External>
                <a className="button button-secondary" href="#features">
                  Explore Features <ArrowRight size={15} />
                </a>
              </div>
            </Reveal>
          </section>
        </main>
        <footer className="footer container">
          <div className="footer-top">
            <div>
              <a href="#top" aria-label="Prism home">
                <Brand />
              </a>
              <p>See every branch. Understand every change.</p>
            </div>
            <nav aria-label="Footer navigation">
              <a href="#features">Features</a>
              <a href="#how-it-works">How It Works</a>
              <a href={REPO}>GitHub</a>
              <a href={ISSUES}>Issues</a>
            </nav>
          </div>
          <div className="footer-bottom">
            <span>© {new Date().getFullYear()} Prism. MIT licensed.</span>
            <span>
              Built by{" "}
              <a href="https://github.com/axvrma">
                Abhishek Verma <ArrowUpRight size={11} />
              </a>
            </span>
            <span>Made for the flow.</span>
          </div>
        </footer>
      </LazyMotion>
    </MotionConfig>
  );
}
