import { Component, type ReactNode } from "react";
import { Button } from "@forge/ui";

/**
 * Keeps one broken view from blanking the whole window. The app around it (autosave, navigation)
 * keeps running, so nothing is lost; the person sees what went wrong and can try again.
 */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: unknown }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("Pixel Forge view crashed:", error);
  }

  componentDidUpdate(prev: { resetKey?: unknown }) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="crash" role="alert">
        <h2>This view stopped working</h2>
        <p className="muted">Your work is still saved. Try again, or switch to another page and back.</p>
        <pre className="mono small">{error.message}</pre>
        <Button variant="primary" onClick={() => this.setState({ error: null })}>Try again</Button>
      </div>
    );
  }
}
