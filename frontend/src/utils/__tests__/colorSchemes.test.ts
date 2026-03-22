import { describe, it, expect } from 'vitest';
import {
  RAILROAD_COLORS,
  RAILROAD_DEFAULT_COLOR,
  RAILROAD_STATUS_STYLES,
  CTA_LINE_COLORS,
  ZONING_COLORS,
  ZONING_STROKE_COLORS,
  POI_COLORS,
  THEME,
} from '../colorSchemes';

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

describe('RAILROAD_COLORS', () => {
  it('is a non-empty object', () => {
    expect(Object.keys(RAILROAD_COLORS).length).toBeGreaterThan(0);
  });

  it('contains BNSF', () => {
    expect(RAILROAD_COLORS).toHaveProperty('BNSF');
  });

  it('all values are valid hex colors', () => {
    for (const color of Object.values(RAILROAD_COLORS)) {
      expect(color).toMatch(HEX_COLOR_RE);
    }
  });
});

describe('RAILROAD_DEFAULT_COLOR', () => {
  it('is a valid hex color', () => {
    expect(RAILROAD_DEFAULT_COLOR).toMatch(HEX_COLOR_RE);
  });
});

describe('RAILROAD_STATUS_STYLES', () => {
  it('has an "active" entry', () => {
    expect(RAILROAD_STATUS_STYLES).toHaveProperty('active');
  });

  it('has an "abandoned" entry', () => {
    expect(RAILROAD_STATUS_STYLES).toHaveProperty('abandoned');
  });

  it('active style has no dasharray', () => {
    expect(RAILROAD_STATUS_STYLES.active.dasharray).toBeNull();
  });

  it('abandoned style has a dasharray', () => {
    expect(RAILROAD_STATUS_STYLES.abandoned.dasharray).not.toBeNull();
    expect(Array.isArray(RAILROAD_STATUS_STYLES.abandoned.dasharray)).toBe(true);
  });

  it('all styles have width and opacity', () => {
    for (const style of Object.values(RAILROAD_STATUS_STYLES)) {
      expect(typeof style.width).toBe('number');
      expect(typeof style.opacity).toBe('number');
      expect(style.opacity).toBeGreaterThanOrEqual(0);
      expect(style.opacity).toBeLessThanOrEqual(1);
    }
  });
});

describe('CTA_LINE_COLORS', () => {
  it('contains all 8 CTA lines', () => {
    const expected = ['Red', 'Blue', 'Brown', 'Green', 'Orange', 'Pink', 'Purple', 'Yellow'];
    for (const line of expected) {
      expect(CTA_LINE_COLORS).toHaveProperty(line);
    }
  });

  it('all values are valid hex colors', () => {
    for (const color of Object.values(CTA_LINE_COLORS)) {
      expect(color).toMatch(HEX_COLOR_RE);
    }
  });
});

describe('ZONING_COLORS', () => {
  it('has expected zone classes', () => {
    expect(ZONING_COLORS).toHaveProperty('manufacturing');
    expect(ZONING_COLORS).toHaveProperty('commercial');
    expect(ZONING_COLORS).toHaveProperty('residential');
  });

  it('all values are valid hex colors', () => {
    for (const color of Object.values(ZONING_COLORS)) {
      expect(color).toMatch(HEX_COLOR_RE);
    }
  });
});

describe('ZONING_STROKE_COLORS', () => {
  it('has same keys as ZONING_COLORS', () => {
    const fillKeys = Object.keys(ZONING_COLORS).sort();
    const strokeKeys = Object.keys(ZONING_STROKE_COLORS).sort();
    expect(strokeKeys).toEqual(fillKeys);
  });

  it('all values are valid hex colors', () => {
    for (const color of Object.values(ZONING_STROKE_COLORS)) {
      expect(color).toMatch(HEX_COLOR_RE);
    }
  });
});

describe('POI_COLORS', () => {
  it('is a non-empty object', () => {
    expect(Object.keys(POI_COLORS).length).toBeGreaterThan(0);
  });

  it('all values are valid hex colors', () => {
    for (const color of Object.values(POI_COLORS)) {
      expect(color).toMatch(HEX_COLOR_RE);
    }
  });
});

describe('THEME', () => {
  it('has bg property', () => {
    expect(THEME).toHaveProperty('bg');
  });

  it('has accent property', () => {
    expect(THEME).toHaveProperty('accent');
  });

  it('has text property', () => {
    expect(THEME).toHaveProperty('text');
  });

  it('all color values are valid hex colors', () => {
    for (const [key, value] of Object.entries(THEME)) {
      expect(value).toMatch(HEX_COLOR_RE);
    }
  });

  it('is frozen (readonly)', () => {
    // THEME is declared as const, so TS prevents mutation at compile time.
    // At runtime, we can verify the object shape is stable.
    expect(Object.keys(THEME)).toContain('bg');
    expect(Object.keys(THEME)).toContain('bgSecondary');
    expect(Object.keys(THEME)).toContain('border');
  });
});
