import {
  GitBranch,
  GitPullRequest,
  ScanLine,
  History,
  Network,
  Sparkles,
  Check,
  ArrowRight,
} from "lucide-react";
import { Reveal } from "../ui/Reveal";
const features = [
  {
    title: "Visual Branch Flows",
    description:
      "Map your branch relationships. Understand what goes where, and in what order.",
    icon: GitBranch,
    visual: "branches",
    label: "THE BIG PICTURE",
  },
  {
    title: "Conflict Intelligence",
    description:
      "Surface conflicts supported by local Git simulation or exact-head Azure DevOps evidence.",
    icon: ScanLine,
    visual: "conflict",
    label: "EVIDENCE, NOT GUESSWORK",
  },
  {
    title: "Pull Request Planning",
    description:
      "Find pending integrations and prepare pull requests through an explicit review workflow.",
    icon: GitPullRequest,
    visual: "pr",
    label: "A CLEAR NEXT STEP",
  },
  {
    title: "Branch Drift Detection",
    description:
      "See when changed commit heads or dependencies make previous analysis stale.",
    icon: History,
    visual: "drift",
    label: "STAY IN SYNC",
  },
  {
    title: "Dependency Awareness",
    description:
      "Follow upstream changes through downstream branches. Plan in dependency order.",
    icon: Network,
    visual: "dependency",
    label: "KNOW THE RIPPLE EFFECT",
  },
  {
    title: "AI-Assisted PRs",
    description:
      "Optionally draft PR titles and descriptions with a supported AI provider. You stay in control.",
    icon: Sparkles,
    visual: "ai",
    label: "OPTIONAL BY DESIGN",
  },
];
export function Features() {
  return (
    <section id="features" className="section features-section container">
      <Reveal>
        <div className="section-eyebrow">
          <span>01 /</span> SEE THE CONNECTIONS
        </div>
        <div className="section-heading-row">
          <h2>
            Clarity across your
            <br />
            entire Git workflow<span className="muted-period">.</span>
          </h2>
          <p>
            From branch dependencies to pull requests,
            <br className="desktop-break" /> Prism brings the moving pieces into
            focus.
          </p>
        </div>
      </Reveal>
      <div className="feature-grid">
        {features.map(({ title, description, icon: Icon, visual, label }) => (
          <Reveal key={title} className={`feature-card feature-${visual}`}>
            <div className="feature-art" aria-hidden="true">
              <FeatureArt type={visual} />
            </div>
            <div className="feature-body">
              <span className="feature-kicker">{label}</span>
              <h3>
                <Icon size={18} />
                {title}
              </h3>
              <p>{description}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
function FeatureArt({ type }: { type: string }) {
  if (type === "branches")
    return (
      <div className="mini-flow">
        <span>
          <GitBranch size={12} />
          main
          <i />
        </span>
        <div className="mini-flow-line" />
        <span>
          <GitBranch size={12} />
          release/2.3
          <i />
        </span>
        <div className="mini-flow-child">
          <span>
            <GitBranch size={12} />
            feature/ui
            <i />
          </span>
        </div>
      </div>
    );
  if (type === "conflict")
    return (
      <div className="mini-evidence">
        <div>
          <span className="art-dot red" /> CONFLICT IDENTIFIED{" "}
          <ScanLine size={13} />
        </div>
        <code>
          <span>14</span> {"<<<<<<<"} release/2.3
        </code>
        <code>
          <span>15</span> retryPayment(order.id)
        </code>
        <p>
          LOCAL GIT SIMULATION <Check size={11} /> EVIDENCE
        </p>
      </div>
    );
  if (type === "pr")
    return (
      <div className="mini-pr">
        <div>
          <GitPullRequest size={18} />
          <strong>Prepare integration</strong>
          <span>DRAFT</span>
        </div>
        <p>
          <code>release/2.2</code>
          <ArrowRight size={12} />
          <code>release/2.3</code>
        </p>
        <div className="mini-pr-bottom">
          <span>4 outstanding commits</span>
          <span>Review first ↗</span>
        </div>
      </div>
    );
  if (type === "drift")
    return (
      <div className="mini-drift">
        <span className="drift-caption">BRANCH HEAD CHANGED</span>
        <div>
          <code>c4e91b0</code>
          <ArrowRight size={15} />
          <code>7f02a6d</code>
        </div>
        <p>
          <History size={13} /> Earlier analysis is now stale
        </p>
      </div>
    );
  if (type === "dependency")
    return (
      <div className="mini-dependency">
        <svg viewBox="0 0 270 130" fill="none">
          <path
            d="M45 65H110V28H216M110 65H216M110 65V102H216"
            stroke="#49405e"
          />
          <path d="M45 65H110V28H216" stroke="#9c7bf5" />
          <circle cx="45" cy="65" r="17" fill="#211a34" stroke="#a78bfa" />
          <circle cx="216" cy="28" r="12" fill="#211a34" stroke="#a78bfa" />
          <circle cx="216" cy="65" r="12" fill="#191820" stroke="#646074" />
          <circle cx="216" cy="102" r="12" fill="#191820" stroke="#646074" />
          <circle cx="45" cy="65" r="5" fill="#bda1ff" />
          <circle cx="216" cy="28" r="3" fill="#bda1ff" />
        </svg>
        <span>UPSTREAM → DOWNSTREAM</span>
      </div>
    );
  return (
    <div className="mini-ai">
      <div>
        <Sparkles size={15} />
        <span>Draft a clearer description</span>
        <span className="ai-key">AI</span>
      </div>
      <i />
      <i />
      <i />
      <p>
        <Check size={12} /> Your review. Your final word.
      </p>
    </div>
  );
}
