/**
 * Accessibility settings control panel.
 *
 * Provides toggles for high-contrast mode and reduced motion, plus a
 * keyboard-shortcut reference.  Designed to sit below the layer panel
 * in the map UI.
 */

import React, { useCallback, useState } from 'react';
import { THEME } from '../../utils/colorSchemes';
import { ARIA_LABELS, announceToScreenReader } from '../../utils/accessibility';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface AccessibilitySettings {
  highContrast: boolean;
  reduceMotion: boolean;
}

interface AccessibilityControlsProps {
  /** Called whenever a setting changes */
  onChange?: (settings: AccessibilitySettings) => void;
}

/* ------------------------------------------------------------------ */
/*  Styles                                                             */
/* ------------------------------------------------------------------ */

const styles = {
  wrapper: {
    position: 'absolute' as const,
    left: '12px',
    bottom: '40px',
    width: '220px',
    background: THEME.bgSecondary,
    border: `1px solid ${THEME.border}`,
    borderRadius: '8px',
    padding: '0',
    zIndex: 40,
    fontFamily: 'inherit',
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 12px',
    borderBottom: `1px solid ${THEME.border}`,
  },
  title: {
    margin: 0,
    fontSize: '12px',
    fontWeight: 600 as const,
    color: THEME.text,
    letterSpacing: '0.02em',
  },
  collapseBtn: {
    background: 'none',
    border: 'none',
    color: THEME.textMuted,
    cursor: 'pointer',
    fontSize: '14px',
    padding: '2px 4px',
    borderRadius: '4px',
    lineHeight: 1,
  },
  content: {
    padding: '8px 12px 12px',
  },
  toggleRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '6px 0',
  },
  label: {
    fontSize: '12px',
    color: THEME.text,
    cursor: 'pointer',
  },
  toggle: {
    position: 'relative' as const,
    width: '34px',
    height: '18px',
    flexShrink: 0 as const,
  },
  toggleInput: {
    opacity: 0,
    width: 0,
    height: 0,
    position: 'absolute' as const,
  },
  toggleTrack: (active: boolean) => ({
    position: 'absolute' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: '9px',
    background: active ? THEME.accent : THEME.bgTertiary,
    border: `1px solid ${active ? THEME.accent : THEME.border}`,
    transition: 'background 0.15s, border-color 0.15s',
    cursor: 'pointer',
  }),
  toggleKnob: (active: boolean) => ({
    position: 'absolute' as const,
    top: '2px',
    left: active ? '17px' : '2px',
    width: '12px',
    height: '12px',
    borderRadius: '50%',
    background: '#fff',
    transition: 'left 0.15s',
    pointerEvents: 'none' as const,
  }),
  divider: {
    height: '1px',
    background: THEME.border,
    margin: '6px 0',
  },
  shortcutTitle: {
    fontSize: '11px',
    fontWeight: 600 as const,
    color: THEME.textMuted,
    margin: '0 0 6px',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.04em',
  },
  shortcutRow: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '3px 0',
    fontSize: '11px',
    color: THEME.textMuted,
  },
  kbd: {
    display: 'inline-block',
    padding: '1px 5px',
    fontSize: '10px',
    fontFamily: 'monospace',
    color: THEME.text,
    background: THEME.bgTertiary,
    border: `1px solid ${THEME.border}`,
    borderRadius: '3px',
    lineHeight: '16px',
  },
  expandBtn: {
    position: 'absolute' as const,
    left: '12px',
    bottom: '40px',
    background: THEME.bgSecondary,
    border: `1px solid ${THEME.border}`,
    borderRadius: '8px',
    color: THEME.text,
    fontSize: '12px',
    padding: '6px 12px',
    cursor: 'pointer',
    zIndex: 40,
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
  },
  focusOutline: {
    outline: `2px solid ${THEME.accent}`,
    outlineOffset: '2px',
  },
} as const;

/* ------------------------------------------------------------------ */
/*  Keyboard shortcut data                                             */
/* ------------------------------------------------------------------ */

const SHORTCUTS: { key: string; description: string }[] = [
  { key: 'Tab', description: 'Move between controls' },
  { key: 'Enter / Space', description: 'Activate buttons' },
  { key: 'Escape', description: 'Close panels' },
  { key: 'Arrow keys', description: 'Navigate lists' },
];

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export const AccessibilityControls: React.FC<AccessibilityControlsProps> = ({
  onChange,
}) => {
  const [collapsed, setCollapsed] = useState(false);
  const [settings, setSettings] = useState<AccessibilitySettings>({
    highContrast: false,
    reduceMotion: false,
  });

  const updateSetting = useCallback(
    (key: keyof AccessibilitySettings) => {
      setSettings((prev) => {
        const next = { ...prev, [key]: !prev[key] };
        onChange?.(next);

        // Announce the change to screen readers
        const label =
          key === 'highContrast' ? 'High contrast mode' : 'Reduce motion mode';
        const state = next[key] ? 'enabled' : 'disabled';
        announceToScreenReader(`${label} ${state}`);

        return next;
      });
    },
    [onChange],
  );

  /* ------ collapsed state ------ */
  if (collapsed) {
    return (
      <button
        style={styles.expandBtn}
        onClick={() => setCollapsed(false)}
        aria-label={ARIA_LABELS.accessibilityPanel}
        onFocus={(e) => Object.assign(e.currentTarget.style, styles.focusOutline)}
        onBlur={(e) => {
          e.currentTarget.style.outline = '';
          e.currentTarget.style.outlineOffset = '';
        }}
      >
        Accessibility
      </button>
    );
  }

  /* ------ expanded state ------ */
  return (
    <aside
      style={styles.wrapper}
      role="region"
      aria-label={ARIA_LABELS.accessibilityPanel}
    >
      {/* Header */}
      <div style={styles.header}>
        <h3 style={styles.title}>Accessibility</h3>
        <button
          style={styles.collapseBtn}
          onClick={() => setCollapsed(true)}
          aria-label="Collapse accessibility panel"
          onFocus={(e) => Object.assign(e.currentTarget.style, styles.focusOutline)}
          onBlur={(e) => {
            e.currentTarget.style.outline = '';
            e.currentTarget.style.outlineOffset = '';
          }}
        >
          &times;
        </button>
      </div>

      <div style={styles.content}>
        {/* High Contrast toggle */}
        <div style={styles.toggleRow}>
          <span style={styles.label}>High Contrast</span>
          <label style={styles.toggle} aria-label={ARIA_LABELS.highContrast}>
            <input
              type="checkbox"
              style={styles.toggleInput}
              checked={settings.highContrast}
              onChange={() => updateSetting('highContrast')}
              onFocus={(e) =>
                Object.assign(
                  (e.currentTarget.nextSibling as HTMLElement).style,
                  styles.focusOutline,
                )
              }
              onBlur={(e) => {
                const track = e.currentTarget.nextSibling as HTMLElement;
                track.style.outline = '';
                track.style.outlineOffset = '';
              }}
            />
            <span style={styles.toggleTrack(settings.highContrast)}>
              <span style={styles.toggleKnob(settings.highContrast)} />
            </span>
          </label>
        </div>

        {/* Reduce Motion toggle */}
        <div style={styles.toggleRow}>
          <span style={styles.label}>Reduce Motion</span>
          <label style={styles.toggle} aria-label={ARIA_LABELS.reduceMotion}>
            <input
              type="checkbox"
              style={styles.toggleInput}
              checked={settings.reduceMotion}
              onChange={() => updateSetting('reduceMotion')}
              onFocus={(e) =>
                Object.assign(
                  (e.currentTarget.nextSibling as HTMLElement).style,
                  styles.focusOutline,
                )
              }
              onBlur={(e) => {
                const track = e.currentTarget.nextSibling as HTMLElement;
                track.style.outline = '';
                track.style.outlineOffset = '';
              }}
            />
            <span style={styles.toggleTrack(settings.reduceMotion)}>
              <span style={styles.toggleKnob(settings.reduceMotion)} />
            </span>
          </label>
        </div>

        <div style={styles.divider} />

        {/* Keyboard shortcuts reference */}
        <p style={styles.shortcutTitle}>Keyboard Navigation</p>
        {SHORTCUTS.map((sc) => (
          <div key={sc.key} style={styles.shortcutRow}>
            <kbd style={styles.kbd}>{sc.key}</kbd>
            <span>{sc.description}</span>
          </div>
        ))}
      </div>
    </aside>
  );
};
