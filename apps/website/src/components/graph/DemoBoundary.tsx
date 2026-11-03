import { Component, type ErrorInfo, type ReactNode } from "react";
export class DemoBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Sample canvas could not load.", error, info.componentStack);
  }
  render() {
    if (this.state.failed)
      return (
        <div className="demo-error" role="status">
          <h3>The sample canvas couldn’t load.</h3>
          <p>
            Prism visualizes integration relationships from main through your
            release branches.
            <br />
            The sample canvas uses illustrative data and never contacts a
            repository.
          </p>
          <code>
            main → release/2.1 → release/2.2 → release/2.3 → feature/checkout
          </code>
          <br />
          <button
            className="small-button"
            onClick={() => window.location.reload()}
          >
            Reload sample
          </button>
        </div>
      );
    return this.props.children;
  }
}
