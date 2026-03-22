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
  { dasharray: number[] | null; width: number; opacity: number }
> = {
  active: { dasharray: null, width: 3, opacity: 1.0 },
  abandoned: { dasharray: [4, 4], width: 2, opacity: 0.5 },
  disused: { dasharray: [6, 3], width: 2, opacity: 0.6 },
  spur: { dasharray: null, width: 1.5, opacity: 1.0 },
  razed: { dasharray: [2, 4], width: 1, opacity: 0.3 },
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
