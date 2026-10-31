import { Component } from 'react';
import { RotateCcw, Home } from 'lucide-react';
import GlitchText from '@/components/ui/GlitchText';
import HudLabel from '@/components/ui/HudLabel';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
    this.handleReset = this.handleReset.bind(this);
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    if (import.meta.env.DEV) {
      console.error('[SYNQ] Uncaught render error', error, info?.componentStack);
    }
  }

  handleReset() {
    this.setState({ error: null });
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <main
        role="alert"
        className="flex min-h-screen flex-col items-center justify-center gap-6 bg-bg px-6 text-center"
      >
        <HudLabel accent>ERR / RENDER FAULT</HudLabel>
        <GlitchText text="Out of sync." className="display text-6xl text-ink" as="h1" />
        <p className="max-w-md text-muted">
          Something broke while drawing this screen. Your code is safe in the room; reload to
          reconnect.
        </p>
        {import.meta.env.DEV && (
          <pre className="max-w-2xl overflow-auto rounded-card border border-line bg-surface p-4 text-left font-mono text-xs text-[#F14C4C]">
            {String(error?.stack || error)}
          </pre>
        )}
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex h-10 items-center gap-2 rounded-full bg-ink px-5 text-sm font-medium text-bg"
          >
            <RotateCcw size={15} aria-hidden /> Reload
          </button>
          <a
            href="/"
            onClick={this.handleReset}
            className="inline-flex h-10 items-center gap-2 rounded-full border border-line-strong px-5 text-sm font-medium text-ink"
          >
            <Home size={15} aria-hidden /> Home
          </a>
        </div>
      </main>
    );
  }
}
