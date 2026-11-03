import { useRef, useState } from "react";
import {
  ArrowRight,
  Blocks,
  Check,
  ChevronDown,
  ChevronRight,
  Files,
  GitBranch,
  GitPullRequest,
  Search,
  Settings,
  Sparkles,
  Terminal,
  X,
} from "lucide-react";
import { BrandMark } from "../ui/Brand";
import { Reveal } from "../ui/Reveal";
export function Showcase() {
  const [tab, setTab] = useState("flow");
  const [title, setTitle] = useState("Integrate release/2.2 into release/2.3");
  const [description, setDescription] = useState(
    "Bring payment retry handling and checkout validation into the next release.",
  );
  const [preview, setPreview] = useState(false);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  function changeTab(next: string) {
    setTab(next);
    setPreview(false);
  }
  return (
    <section id="workflow" className="section showcase-section">
      <div className="container">
        <Reveal>
          <div className="section-eyebrow">
            <span>03 /</span> RIGHT WHERE YOU WORK
          </div>
          <div className="section-heading-row">
            <h2>
              Built for the way
              <br />
              engineers actually work<span className="muted-period">.</span>
            </h2>
            <p>
              Your editor. Your repository. Your workflow.
              <br />
              One less thing to keep in your head.
            </p>
          </div>
        </Reveal>
        <Reveal>
          <div
            className="showcase-tabs"
            role="tablist"
            aria-label="Conceptual product views"
            onKeyDown={(e) => {
              if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
                e.preventDefault();
                const i =
                  e.key === "Home"
                    ? 0
                    : e.key === "End"
                      ? 1
                      : tab === "flow"
                        ? 1
                        : 0;
                changeTab(i === 0 ? "flow" : "pr");
                tabRefs.current[i]?.focus();
              }
            }}
          >
            {[
              { id: "flow", label: "Branch Flow", icon: GitBranch },
              { id: "pr", label: "PR Creator", icon: GitPullRequest },
            ].map(({ id, label, icon: Icon }, i) => (
              <button
                key={id}
                id={`tab-${id}`}
                ref={(el) => {
                  tabRefs.current[i] = el;
                }}
                role="tab"
                aria-selected={tab === id}
                aria-controls={`panel-${id}`}
                tabIndex={tab === id ? 0 : -1}
                onClick={() => changeTab(id)}
              >
                <Icon size={15} />
                {label}
              </button>
            ))}
          </div>
          <div
            className="editor-window"
            role="tabpanel"
            tabIndex={0}
            id={`panel-${tab}`}
            aria-labelledby={`tab-${tab}`}
          >
            <div className="editor-top">
              <div className="window-dots" aria-hidden="true">
                <i />
                <i />
                <i />
              </div>
              <span>commerce-platform — Visual Studio Code</span>
              <span className="concept-label">CONCEPTUAL INTERFACE</span>
            </div>
            <div className="editor-content">
              <div className="activity-bar" aria-hidden="true">
                <Files />
                <Search />
                <GitBranch />
                <Blocks />
                <BrandMark />
                <Settings className="activity-settings" />
              </div>
              <div className="editor-sidebar">
                <span className="sidebar-title">PRISM</span>
                <div>
                  <ChevronDown size={12} /> BRANCH FLOW
                </div>
                <span className="sidebar-file">
                  <GitBranch size={13} /> release-train
                </span>
                <span className="sidebar-file muted">
                  <ChevronRight size={12} /> Recent graphs
                </span>
                <div>
                  <ChevronDown size={12} /> PR HELPER
                </div>
                <span className="sidebar-file">
                  <GitPullRequest size={13} /> Create pull request
                </span>
                <div className="sidebar-bottom">
                  <span className="pulse-dot" /> Azure DevOps configured
                </div>
              </div>
              <div className="editor-main">
                <div className="editor-file">
                  <span>
                    {tab === "flow" ? (
                      <GitBranch size={13} />
                    ) : (
                      <GitPullRequest size={13} />
                    )}{" "}
                    {tab === "flow"
                      ? "release-train.branchflow.json"
                      : "Pull Request Creator"}{" "}
                    <X size={12} />
                  </span>
                </div>
                {tab === "flow" ? (
                  <div className="showcase-flow">
                    <div className="showcase-breadcrumb">
                      commerce-platform <ChevronRight size={12} /> Branch Flow
                    </div>
                    <div
                      className="concept-graph"
                      aria-label="Conceptual flow: main to release 2.2, then release 2.3"
                    >
                      <div className="concept-line line-one" />
                      <div className="concept-line line-two" />
                      <div className="concept-node cn-one">
                        <GitBranch size={14} />
                        <strong>main</strong>
                        <span>
                          <Check size={11} /> Synced
                        </span>
                      </div>
                      <div className="concept-node cn-two">
                        <GitBranch size={14} />
                        <strong>release/2.2</strong>
                        <span>
                          <Check size={11} /> Synced
                        </span>
                      </div>
                      <div className="concept-node cn-three">
                        <GitBranch size={14} />
                        <strong>release/2.3</strong>
                        <span className="yellow">● Action required</span>
                      </div>
                      <div className="concept-edge-label">
                        4 COMMITS TO INTEGRATE
                      </div>
                    </div>
                    <div className="concept-hint">
                      <Terminal size={13} />
                      <span>
                        Relationships describe intent. Analysis provides
                        evidence.
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="pr-demo">
                    {preview ? (
                      <div className="pr-preview">
                        <span className="feature-kicker">
                          LOCAL SAMPLE PREVIEW
                        </span>
                        <h3>{title || "Untitled pull request"}</h3>
                        <p>{description || "No description provided."}</p>
                        <div className="pr-branches">
                          <code>release/2.2</code>
                          <ArrowRight size={12} />
                          <code>release/2.3</code>
                        </div>
                        <p className="preview-note">
                          <Check size={14} /> Preview ready. No pull request was
                          submitted.
                        </p>
                        <button
                          className="small-button"
                          onClick={() => setPreview(false)}
                        >
                          Back to edit
                        </button>
                      </div>
                    ) : (
                      <>
                        <div className="pr-form-heading">
                          <GitPullRequest size={19} />
                          <h3>Create a pull request</h3>
                        </div>
                        <div className="pr-branches">
                          <code>release/2.2</code>
                          <ArrowRight size={13} />
                          <code>release/2.3</code>
                        </div>
                        <label htmlFor="pr-title">Title</label>
                        <input
                          id="pr-title"
                          value={title}
                          maxLength={200}
                          onChange={(e) => setTitle(e.target.value)}
                        />
                        <label htmlFor="pr-description">
                          Description <span>Editable sample</span>
                        </label>
                        <textarea
                          id="pr-description"
                          value={description}
                          maxLength={2000}
                          onChange={(e) => setDescription(e.target.value)}
                        />
                        <div className="pr-form-actions">
                          <span>
                            <Sparkles size={12} /> AI is optional
                          </span>
                          <button
                            className="small-button"
                            onClick={() => setPreview(true)}
                          >
                            Preview sample <ArrowRight size={12} />
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
              {tab === "flow" && (
                <aside className="concept-inspector">
                  <span className="feature-kicker">RELATIONSHIP</span>
                  <h3>
                    release/2.2 <ArrowRight size={12} />
                    <br />
                    release/2.3
                  </h3>
                  <span className="concept-status">● ACTION REQUIRED</span>
                  <dl>
                    <div>
                      <dt>Outstanding</dt>
                      <dd>4 commits</dd>
                    </div>
                    <div>
                      <dt>Active PR</dt>
                      <dd>None</dd>
                    </div>
                  </dl>
                  <p>Merge not simulated. Conflict evidence is unavailable.</p>
                  <button
                    className="small-button"
                    onClick={() => changeTab("pr")}
                  >
                    Prepare sample PR <ArrowRight size={12} />
                  </button>
                </aside>
              )}
            </div>
            <div className="editor-status">
              <span>
                <GitBranch size={11} /> release/2.3 <Check size={11} />
              </span>
              <span>Prism · Azure DevOps</span>
            </div>
          </div>
          <p className="showcase-caption">
            A conceptual product walkthrough, based on the extension’s
            capabilities. Sample data throughout.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
