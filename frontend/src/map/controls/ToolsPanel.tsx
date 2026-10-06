/**
 * Right-hand sidebar holding the Focus Areas and Contact List panels.
 * Mirrors the left LayerPanel: collapsible, and when collapsed leaves a button showing
 * the contact count so a list in progress is never out of sight.
 */
import React, { useState } from 'react';

interface ToolsPanelProps {
  badge: number;
  children: React.ReactNode;
}

// O(1) time, O(1) space
export const ToolsPanel: React.FC<ToolsPanelProps> = ({ badge, children }) => {
  const [collapsed, setCollapsed] = useState(false);

  if (collapsed) {
    return (
      <button
        type="button"
        className="tools-panel__toggle-btn"
        onClick={() => setCollapsed(false)}
        aria-label="Open tools panel"
      >
        Tools{badge > 0 ? ` · ${badge}` : ''}
      </button>
    );
  }

  return (
    <aside className="tools-panel" aria-label="Focus areas and contact list">
      <div className="layer-panel__header">
        <h2 className="layer-panel__title">Tools</h2>
        <button
          type="button"
          className="layer-panel__close"
          onClick={() => setCollapsed(true)}
          aria-label="Close tools panel"
        >
          &times;
        </button>
      </div>
      <div className="tools-panel__content">{children}</div>
    </aside>
  );
};
