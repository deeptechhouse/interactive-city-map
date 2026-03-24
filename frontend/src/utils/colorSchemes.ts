/** Railroad owner colors */
export const RAILROAD_COLORS: Record<string, string> = {
  BNSF: '#FF6600',
  CP: '#FF0000',
  CPKC: '#FF0000',
  'Canadian Pacific': '#FF0000',
  NS: '#006400',
  'Norfolk Southern': '#006400',
  CSX: '#0000FF',
  CN: '#EE0000',
  CTA: '#00A1DE',
};

export const RAILROAD_DEFAULT_COLOR = '#888888';

/** Railroad line style by status */
export const RAILROAD_STATUS_STYLES: Record<
  string,
  { dasharray: number[] | null; width: number; opacity: number; colorOverride?: string }
> = {
  active: { dasharray: null, width: 3, opacity: 1.0 },
  abandoned: { dasharray: [4, 4], width: 2.5, opacity: 0.85, colorOverride: '#ef4444' },
  disused: { dasharray: [6, 3], width: 2.5, opacity: 0.8, colorOverride: '#f59e0b' },
  spur: { dasharray: null, width: 1.5, opacity: 0.9 },
  razed: { dasharray: [2, 4], width: 1.5, opacity: 0.5, colorOverride: '#6b7280' },
};

/** CTA transit line colors */
export const CTA_LINE_COLORS: Record<string, string> = {
  Red: '#C60C30',
  Blue: '#00A1DE',
  Brown: '#62361B',
  Green: '#009B3A',
  Orange: '#F9461C',
  Pink: '#E27EA6',
  Purple: '#522398',
  Yellow: '#F9E300',
};

/** Zoning class colors */
export const ZONING_COLORS: Record<string, string> = {
  manufacturing: '#D4A574',
  commercial: '#FF6B6B',
  residential: '#90EE90',
  mixed: '#DDA0DD',
  special: '#FFD700',
};

/** Zoning stroke colors (darker shade of fill) */
export const ZONING_STROKE_COLORS: Record<string, string> = {
  manufacturing: '#A67C52',
  commercial: '#CC4444',
  residential: '#5CB85C',
  mixed: '#AA66AA',
  special: '#CCA800',
};

/** POI category colors */
export const POI_COLORS: Record<string, string> = {
  performance_arts: '#E53E3E',
  hospitality_events: '#DD6B20',
  creative_production: '#805AD5',
  cultural_community: '#2B6CB0',
  parks: '#38A169',
};

/** Building fill colors by property class */
export const BUILDING_CLASS_COLORS: Record<string, string> = {
  commercial: '#ef4444',       // red
  residential: '#22c55e',      // green
  industrial: '#f59e0b',       // amber
  mixed_use: '#a855f7',        // purple
  institutional: '#3b82f6',    // blue
  government: '#06b6d4',       // cyan
  religious: '#ec4899',        // pink
  educational: '#8b5cf6',      // violet
  medical: '#14b8a6',          // teal
  entertainment: '#f97316',    // orange
  hotel: '#eab308',            // yellow
  warehouse: '#78716c',        // stone
  parking: '#6b7280',          // gray
  vacant: '#374151',           // dark gray
};

export const BUILDING_DEFAULT_COLOR = '#334155';

/** Building owner type colors (used for border highlighting) */
export const OWNER_TYPE_COLORS: Record<string, string> = {
  government: '#06b6d4',
  corporate: '#ef4444',
  nonprofit: '#22c55e',
  individual: '#8b949e',
  religious: '#ec4899',
  educational: '#8b5cf6',
};

/** Police district colors (22 active districts) */
export const DISTRICT_COLORS: Record<number, string> = {
  1: '#ef4444',  2: '#f97316',  3: '#f59e0b',  4: '#eab308',  5: '#84cc16',
  6: '#22c55e',  7: '#10b981',  8: '#14b8a6',  9: '#06b6d4',  10: '#0ea5e9',
  11: '#3b82f6', 12: '#6366f1', 14: '#8b5cf6', 15: '#a855f7', 16: '#d946ef',
  17: '#ec4899', 18: '#f43f5e', 19: '#fb923c', 20: '#a3e635', 22: '#2dd4bf',
  24: '#38bdf8', 25: '#818cf8', 31: '#6b7280',
};

/** Ward colors (50 wards — cycling through distinct hues) */
export const WARD_COLORS: Record<number, string> = {
  1: '#ef4444',  2: '#f97316',  3: '#f59e0b',  4: '#eab308',  5: '#84cc16',
  6: '#22c55e',  7: '#10b981',  8: '#14b8a6',  9: '#06b6d4',  10: '#0ea5e9',
  11: '#3b82f6', 12: '#6366f1', 13: '#8b5cf6', 14: '#a855f7', 15: '#d946ef',
  16: '#ec4899', 17: '#f43f5e', 18: '#fb7185', 19: '#fda4af', 20: '#fdba74',
  21: '#fcd34d', 22: '#bef264', 23: '#86efac', 24: '#6ee7b7', 25: '#5eead4',
  26: '#67e8f9', 27: '#7dd3fc', 28: '#93c5fd', 29: '#a5b4fc', 30: '#c4b5fd',
  31: '#d8b4fe', 32: '#f0abfc', 33: '#f9a8d4', 34: '#fca5a5', 35: '#fdba74',
  36: '#fde047', 37: '#a3e635', 38: '#4ade80', 39: '#34d399', 40: '#2dd4bf',
  41: '#22d3ee', 42: '#38bdf8', 43: '#60a5fa', 44: '#818cf8', 45: '#a78bfa',
  46: '#c084fc', 47: '#e879f9', 48: '#f472b6', 49: '#fb923c', 50: '#facc15',
};

/** Gang territory colors (45 gangs — 2025 CPD boundaries) */
export const GANG_COLORS: Record<string, string> = {
  'AMBROSE': '#ef4444', 'BISHOPS': '#f97316', 'BLACK DISCIPLES': '#f59e0b',
  'BLACK P STONES': '#eab308', 'BLACK SOULS': '#84cc16', 'C-NOTES': '#22c55e',
  'CICERO INSANE VICE LORDS': '#10b981', 'CONSERVATIVE VICE LORDS': '#14b8a6',
  'FOUR CORNER HUSTLERS': '#06b6d4', 'GANGSTER DISCIPLES': '#0ea5e9',
  'HARRISON GENTS': '#3b82f6', 'IMPERIAL GANGSTERS': '#6366f1',
  'INSANE DEUCES': '#8b5cf6', 'INSANE DRAGONS': '#a855f7',
  'KRAZY GETDOWN BOYS': '#d946ef', 'LA FAMILIA STONES': '#ec4899',
  'LA RAZA': '#f43f5e', 'LATIN BROTHERS ORGANIZATION': '#fb7185',
  'LATIN COUNTS': '#fda4af', 'LATIN DRAGONS': '#fdba74',
  'LATIN EAGLES': '#fcd34d', 'LATIN KINGS': '#bef264',
  'LATIN SAINTS': '#86efac', 'LATIN STYLERS': '#6ee7b7',
  'MAFIA INSANE VICE LORDS': '#5eead4', 'MANIAC CAMPBELL BOYS': '#67e8f9',
  'MANIAC LATIN DISCIPLES': '#7dd3fc', 'MICKEY COBRAS': '#93c5fd',
  'MILWAUKEE KINGS': '#a5b4fc', 'NEW BREED': '#c4b5fd',
  'ORCHESTRA ALBANY': '#d8b4fe', 'PACHUCOS': '#f0abfc',
  'PARTY PEOPLE': '#f9a8d4', 'SATAN DISCIPLES': '#fca5a5',
  'SPANISH COBRAS': '#fdba74', 'SPANISH FOUR CORNER HUSTLERS': '#fde047',
  'SPANISH GANGSTER DISCIPLES': '#a3e635', 'SPANISH VICE LORDS': '#4ade80',
  'TRAVELING VICE LORDS': '#34d399', 'TWO SIX': '#2dd4bf',
  'TWO-TWO BOYS': '#22d3ee', 'UNDERTAKER VICE LORDS': '#38bdf8',
  'UNKNOWN VICE LORDS': '#60a5fa', 'VICE LORDS': '#818cf8',
  'YOUNG LATIN ORGANIZATION COBRAS': '#a78bfa',
};

/** Federal property category colors */
export const FEDERAL_CATEGORY_COLORS: Record<string, string> = {
  law_enforcement: '#ef4444',  // red
  courts: '#3b82f6',           // blue
  regulatory: '#22c55e',       // green
  revenue_services: '#eab308', // yellow
  postal: '#8b5cf6',           // violet
  military: '#ec4899',         // pink
  financial: '#10b981',        // emerald
  healthcare: '#06b6d4',       // cyan
};

/** App theme colors */
export const THEME = {
  bg: '#0d1117',
  bgSecondary: '#161b22',
  bgTertiary: '#21262d',
  text: '#c9d1d9',
  textMuted: '#8b949e',
  accent: '#58a6ff',
  border: '#30363d',
  success: '#3fb950',
  warning: '#d29922',
  danger: '#f85149',
} as const;
