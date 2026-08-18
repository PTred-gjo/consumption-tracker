import React from 'react';

/**
 * Last line of defence around the app.
 *
 * All user data lives in localStorage on the device with no server copy, so a
 * crash must never leave the user staring at a blank screen: the fallback
 * always offers a raw data export before anything else.
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Surfaces in `adb logcat` for a released Android build.
    console.error('FuelPilot crashed:', error, info?.componentStack);
  }

  handleExport = () => {
    try {
      const dump = {};
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('fuelpilot')) dump[key] = localStorage.getItem(key);
      }
      const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `fuelpilot-recovery-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch {
      window.alert('The data could not be exported from this device.');
    }
  };

  render() {
    if (!this.state.error) return this.props.children;

    const buttonStyle = {
      border: '1px solid #2C2C2E',
      borderRadius: 10,
      padding: '12px 16px',
      fontSize: 15,
      fontWeight: 600,
      cursor: 'pointer',
      width: '100%',
    };

    return (
      <div
        role="alert"
        style={{
          minHeight: '100vh',
          background: '#0A0A0A',
          color: '#F5F5F3',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
        }}
      >
        <div style={{ maxWidth: 420, width: '100%' }}>
          <div style={{ fontSize: 44, textAlign: 'center', marginBottom: 12 }}>⚠️</div>
          <h1 style={{ fontSize: 20, fontWeight: 800, textAlign: 'center', margin: '0 0 8px' }}>
            Something went wrong
          </h1>
          <p style={{ color: '#8E8E93', textAlign: 'center', lineHeight: 1.6, margin: '0 0 20px' }}>
            Your saved data is still on this device. Export a copy first if you want to be safe, then reload.
          </p>

          <div style={{ display: 'grid', gap: 8 }}>
            <button type="button" onClick={this.handleExport} style={{ ...buttonStyle, background: '#1C1C1E', color: '#F5F5F3' }}>
              💾 Export my data
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{ ...buttonStyle, background: '#3B82F6', color: '#fff', border: '1px solid #3B82F6' }}
            >
              ↻ Reload the app
            </button>
          </div>

          <details style={{ marginTop: 20 }}>
            <summary style={{ color: '#8E8E93', fontSize: 13, cursor: 'pointer' }}>Technical details</summary>
            <pre
              style={{
                marginTop: 8,
                background: '#141414',
                border: '1px solid #2C2C2E',
                borderRadius: 10,
                padding: 12,
                fontSize: 11,
                color: '#8E8E93',
                overflowX: 'auto',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {String(this.state.error?.stack || this.state.error)}
            </pre>
          </details>
        </div>
      </div>
    );
  }
}
