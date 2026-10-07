import React, { StrictMode, Component } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.jsx';

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('Disha Rescue Dashboard uncaught error:', error, errorInfo);
    this.setState({ errorInfo });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          backgroundColor: '#F5F6F8',
          fontFamily: "'Outfit', system-ui, sans-serif",
          padding: '24px',
          color: '#18181B',
        }}>
          <div style={{
            maxWidth: '600px',
            width: '100%',
            background: '#ffffff',
            borderRadius: '24px',
            padding: '32px',
            boxShadow: '0 4px 20px rgba(0,0,0,0.06)',
            border: '1px solid #E2E8F0',
          }}>
            <h2 style={{ color: '#EF4444', margin: '0 0 12px 0', fontSize: '22px' }}>
              Dashboard Encountered an Error
            </h2>
            <p style={{ color: '#64748B', fontSize: '14px', lineHeight: 1.5, margin: '0 0 16px 0' }}>
              {this.state.error?.message || 'An unexpected rendering error occurred.'}
            </p>
            {this.state.error?.stack && (
              <pre style={{
                background: '#F1F5F9',
                padding: '12px',
                borderRadius: '12px',
                fontSize: '11px',
                overflowX: 'auto',
                color: '#334155',
                maxHeight: '200px',
              }}>
                {this.state.error.stack}
              </pre>
            )}
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                marginTop: '16px',
                padding: '10px 20px',
                borderRadius: '12px',
                backgroundColor: '#3B82F6',
                color: '#ffffff',
                border: 'none',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Reload Application
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
