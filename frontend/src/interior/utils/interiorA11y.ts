// ARIA labels and roles for interior components
export const INTERIOR_ARIA = {
  viewer: {
    role: 'region' as const,
    label: 'Interior building map viewer',
  },
  floorSelector: {
    role: 'tablist' as const,
    label: 'Floor level selector',
    tabRole: 'tab' as const,
  },
  sourceSelector: {
    role: 'radiogroup' as const,
    label: 'Data source selector',
  },
  editor: {
    role: 'toolbar' as const,
    label: 'Interior map editor tools',
  },
  roomPopup: {
    role: 'dialog' as const,
    label: 'Room information',
  },
};

// Keyboard navigation helpers
export function handleFloorSelectorKeyboard(
  event: React.KeyboardEvent,
  levels: number[],
  currentLevel: number,
  onLevelChange: (level: number) => void,
): void {
  const currentIndex = levels.indexOf(currentLevel);
  if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
    event.preventDefault();
    const newIndex = Math.max(0, currentIndex - 1);
    onLevelChange(levels[newIndex]);
  } else if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
    event.preventDefault();
    const newIndex = Math.min(levels.length - 1, currentIndex + 1);
    onLevelChange(levels[newIndex]);
  }
}

export function handleEditorKeyboard(
  event: KeyboardEvent,
  callbacks: {
    onUndo: () => void;
    onRedo: () => void;
    onEscape: () => void;
    onDelete: () => void;
  },
): void {
  if (event.ctrlKey || event.metaKey) {
    if (event.key === 'z' && !event.shiftKey) {
      event.preventDefault();
      callbacks.onUndo();
    }
    if (event.key === 'z' && event.shiftKey) {
      event.preventDefault();
      callbacks.onRedo();
    }
  }
  if (event.key === 'Escape') callbacks.onEscape();
  if (event.key === 'Delete' || event.key === 'Backspace') callbacks.onDelete();
}

// Screen reader announcements
export function announceToScreenReader(message: string): void {
  const el = document.createElement('div');
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.setAttribute('aria-atomic', 'true');
  el.style.position = 'absolute';
  el.style.left = '-9999px';
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => document.body.removeChild(el), 1000);
}

// Focus trap for modals/popups
export function createFocusTrap(
  container: HTMLElement,
): { activate: () => void; deactivate: () => void } {
  const focusableSelector =
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
  let previousFocus: HTMLElement | null = null;

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key !== 'Tab') return;
    const focusable = Array.from(
      container.querySelectorAll<HTMLElement>(focusableSelector),
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  return {
    activate() {
      previousFocus = document.activeElement as HTMLElement;
      container.addEventListener('keydown', handleKeyDown);
      const first = container.querySelector<HTMLElement>(focusableSelector);
      first?.focus();
    },
    deactivate() {
      container.removeEventListener('keydown', handleKeyDown);
      previousFocus?.focus();
    },
  };
}
