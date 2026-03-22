/**
 * Accessibility utilities for the interactive city map.
 *
 * Provides screen-reader announcements, focus management, WCAG contrast
 * checking, centralised ARIA label strings, and keyboard-navigation helpers.
 */

/* ------------------------------------------------------------------ */
/*  Screen-Reader Announcements                                        */
/* ------------------------------------------------------------------ */

let liveRegion: HTMLElement | null = null;

/**
 * Announce a message to assistive technology via an `aria-live` region.
 *
 * The region is lazily created and appended to `<body>` the first time
 * this function is called.  Subsequent calls update its text content,
 * which triggers a screen-reader announcement.
 */
export function announceToScreenReader(message: string): void {
  if (!liveRegion) {
    liveRegion = document.createElement('div');
    liveRegion.setAttribute('role', 'status');
    liveRegion.setAttribute('aria-live', 'polite');
    liveRegion.setAttribute('aria-atomic', 'true');
    Object.assign(liveRegion.style, {
      position: 'absolute',
      width: '1px',
      height: '1px',
      padding: '0',
      margin: '-1px',
      overflow: 'hidden',
      clip: 'rect(0, 0, 0, 0)',
      whiteSpace: 'nowrap',
      border: '0',
    });
    document.body.appendChild(liveRegion);
  }

  // Clear first so repeated identical messages still fire
  liveRegion.textContent = '';
  requestAnimationFrame(() => {
    if (liveRegion) {
      liveRegion.textContent = message;
    }
  });
}

/* ------------------------------------------------------------------ */
/*  Focus Management                                                   */
/* ------------------------------------------------------------------ */

/**
 * Trap keyboard focus inside `container` so that Tab / Shift+Tab cycle
 * only through focusable children.
 *
 * Returns a cleanup function that removes the event listener.
 */
export function trapFocus(container: HTMLElement): () => void {
  const focusableSelector = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
  ].join(', ');

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key !== 'Tab') return;

    const focusable = Array.from(
      container.querySelectorAll<HTMLElement>(focusableSelector),
    );
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  container.addEventListener('keydown', handleKeyDown);
  return () => {
    container.removeEventListener('keydown', handleKeyDown);
  };
}

/**
 * Restore focus to the element that was active before a modal/panel
 * was opened.
 */
export function restoreFocus(previousElement: HTMLElement): void {
  if (previousElement && typeof previousElement.focus === 'function') {
    previousElement.focus();
  }
}

/* ------------------------------------------------------------------ */
/*  WCAG Contrast Ratio                                                */
/* ------------------------------------------------------------------ */

/** Parse a hex color (#RGB or #RRGGBB) into [r, g, b] on a 0-255 scale. */
function parseHex(hex: string): [number, number, number] {
  let raw = hex.replace(/^#/, '');

  // Expand shorthand (#abc -> #aabbcc)
  if (raw.length === 3) {
    raw = raw[0] + raw[0] + raw[1] + raw[1] + raw[2] + raw[2];
  }

  return [
    parseInt(raw.slice(0, 2), 16),
    parseInt(raw.slice(2, 4), 16),
    parseInt(raw.slice(4, 6), 16),
  ];
}

/** Convert an sRGB channel value (0-255) to relative luminance component. */
function srgbToLinear(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** Relative luminance per WCAG 2.x (range 0-1). */
function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHex(hex);
  return (
    0.2126 * srgbToLinear(r) +
    0.7152 * srgbToLinear(g) +
    0.0722 * srgbToLinear(b)
  );
}

/**
 * Calculate the WCAG contrast ratio between two hex colors.
 *
 * @returns A value between 1 and 21.
 */
export function getContrastRatio(fg: string, bg: string): number {
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Check whether two colours meet the minimum WCAG contrast requirement.
 *
 * | Level | Normal text | Large text |
 * |-------|-------------|------------|
 * | AA    | 4.5 : 1     | 3 : 1     |
 * | AAA   | 7 : 1       | 4.5 : 1   |
 *
 * This helper checks the **normal-text** threshold for the requested level.
 */
export function meetsContrastRequirement(
  fg: string,
  bg: string,
  level: 'AA' | 'AAA',
): boolean {
  const ratio = getContrastRatio(fg, bg);
  return level === 'AA' ? ratio >= 4.5 : ratio >= 7;
}

/* ------------------------------------------------------------------ */
/*  Centralised ARIA Labels                                            */
/* ------------------------------------------------------------------ */

/**
 * Templated ARIA label strings for interactive map UI elements.
 *
 * Use `ARIA_LABELS.toggleLayer('Buildings')` rather than inlining
 * label strings so they stay consistent across the entire app.
 */
export const ARIA_LABELS = {
  /** Layer visibility checkbox / toggle */
  toggleLayer: (name: string) => `Toggle layer visibility for ${name}`,

  /** Opacity slider */
  setOpacity: (name: string) => `Set opacity for ${name}`,

  /** Main search input */
  search:
    'Search for locations, buildings, and points of interest',

  /** Building / POI detail panel */
  detailPanel: 'Building detail panel',

  /** Generic close action */
  closePanel: 'Close panel',

  /** Zoom-in control */
  zoomIn: 'Zoom in',

  /** Zoom-out control */
  zoomOut: 'Zoom out',

  /** Map container */
  mapContainer: 'Interactive city map',

  /** Layer panel */
  layerPanel: 'Map layer controls',

  /** Accessibility settings panel */
  accessibilityPanel: 'Accessibility settings',

  /** High-contrast toggle */
  highContrast: 'Toggle high-contrast mode',

  /** Reduce-motion toggle */
  reduceMotion: 'Toggle reduce-motion mode',
} as const;

/* ------------------------------------------------------------------ */
/*  Keyboard Navigation Helpers                                        */
/* ------------------------------------------------------------------ */

/**
 * Handle arrow-key navigation through a list of focusable items.
 *
 * Moves focus up/down (or left/right) and wraps around at the edges.
 * Call this from an `onKeyDown` handler on the list container.
 */
export function handleArrowKeyNavigation(
  e: KeyboardEvent,
  items: HTMLElement[],
  currentIndex: number,
): void {
  if (items.length === 0) return;

  let nextIndex: number | null = null;

  switch (e.key) {
    case 'ArrowDown':
    case 'ArrowRight':
      nextIndex = (currentIndex + 1) % items.length;
      break;
    case 'ArrowUp':
    case 'ArrowLeft':
      nextIndex = (currentIndex - 1 + items.length) % items.length;
      break;
    case 'Home':
      nextIndex = 0;
      break;
    case 'End':
      nextIndex = items.length - 1;
      break;
    default:
      return; // not an arrow key — do nothing
  }

  e.preventDefault();
  items[nextIndex].focus();
}

/**
 * Standard Escape-key handler for closing panels / modals.
 *
 * Call from a `keydown` listener:
 * ```ts
 * document.addEventListener('keydown', (e) =>
 *   handleEscapeKey(e, () => setOpen(false)),
 * );
 * ```
 */
export function handleEscapeKey(
  e: KeyboardEvent,
  onClose: () => void,
): void {
  if (e.key === 'Escape') {
    e.preventDefault();
    onClose();
  }
}
