export const ROOM_TYPE_COLORS: Record<string, string> = {
  bedroom: '#6366f1',
  bathroom: '#06b6d4',
  kitchen: '#f59e0b',
  living: '#10b981',
  dining: '#8b5cf6',
  office: '#3b82f6',
  closet: '#6b7280',
  garage: '#78716c',
  hallway: '#9ca3af',
  corridor: '#9ca3af',
  lobby: '#14b8a6',
  ballroom: '#ec4899',
  conference: '#f97316',
  meeting: '#f97316',
  storage: '#a3a3a3',
  utility: '#a3a3a3',
  mechanical: '#737373',
  restroom: '#22d3ee',
  lounge: '#a78bfa',
  library: '#92400e',
  chapel: '#c084fc',
  sanctuary: '#c084fc',
  gym: '#ef4444',
  pool: '#0ea5e9',
  stage: '#e11d48',
  auditorium: '#be185d',
  room: '#64748b',
  unknown: '#475569',
};

export const ROOM_DEFAULT_COLOR = '#64748b';

export const WALL_STYLES: Record<
  string,
  { color: string; width: number; dasharray?: number[] }
> = {
  interior: { color: '#374151', width: 2 },
  exterior: { color: '#111827', width: 3 },
  partition: { color: '#6b7280', width: 1, dasharray: [4, 2] },
};

export const FEATURE_ICONS: Record<string, { emoji: string; color: string }> = {
  door: { emoji: '\uD83D\uDEAA', color: '#f59e0b' },
  stair: { emoji: '\uD83E\uDE9C', color: '#8b5cf6' },
  elevator: { emoji: '\uD83D\uDED7', color: '#3b82f6' },
  restroom: { emoji: '\uD83D\uDEBB', color: '#06b6d4' },
  exit: { emoji: '\uD83D\uDEAA', color: '#ef4444' },
  utility: { emoji: '\u26A1', color: '#f97316' },
};

export const SOURCE_TYPE_LABELS: Record<
  string,
  { label: string; color: string }
> = {
  sanborn: { label: 'Sanborn Map', color: '#d97706' },
  venue_scrape: { label: 'Venue Website', color: '#7c3aed' },
  upload: { label: 'User Upload', color: '#2563eb' },
  osm: { label: 'OpenStreetMap', color: '#16a34a' },
  county_records: { label: 'County Records', color: '#dc2626' },
};

export const CONFIDENCE_COLORS = {
  high: '#22c55e',
  medium: '#eab308',
  low: '#ef4444',
};

export function getConfidenceColor(confidence: number): string {
  if (confidence >= 0.7) return CONFIDENCE_COLORS.high;
  if (confidence >= 0.4) return CONFIDENCE_COLORS.medium;
  return CONFIDENCE_COLORS.low;
}

export function getRoomColor(roomType: string | null): string {
  return (
    ROOM_TYPE_COLORS[(roomType ?? 'unknown').toLowerCase()] ??
    ROOM_DEFAULT_COLOR
  );
}
