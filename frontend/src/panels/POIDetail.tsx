import React from 'react';
import type { POI } from '../types/poi';
import { POI_CATEGORY_LABELS, POI_CATEGORY_COLORS } from '../types/poi';
import { THEME } from '../utils/colorSchemes';

interface POIDetailProps {
  poi: POI;
  onClose: () => void;
}

const styles = {
  overlay: {
    position: 'fixed' as const,
    top: 0,
    right: 0,
    width: '380px',
    height: '100vh',
    background: THEME.bg,
    borderLeft: `1px solid ${THEME.border}`,
    zIndex: 100,
    display: 'flex',
    flexDirection: 'column' as const,
    animation: 'slideInRight 0.25s ease-out',
    boxShadow: '-4px 0 16px rgba(0, 0, 0, 0.4)',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '16px',
    borderBottom: `1px solid ${THEME.border}`,
    flexShrink: 0 as const,
  },
  headerTitle: {
    margin: 0,
    fontSize: '15px',
    fontWeight: 600 as const,
    color: THEME.text,
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    color: THEME.textMuted,
    fontSize: '20px',
    cursor: 'pointer',
    padding: '4px 8px',
    borderRadius: '4px',
    lineHeight: 1,
  },
  content: {
    flex: 1,
    overflowY: 'auto' as const,
    padding: '16px',
  },
  section: {
    marginBottom: '20px',
  },
  sectionTitle: {
    fontSize: '11px',
    fontWeight: 600 as const,
    color: THEME.textMuted,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.5px',
    marginBottom: '8px',
  },
  field: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    padding: '6px 0',
    borderBottom: `1px solid ${THEME.bgTertiary}`,
    fontSize: '13px',
  },
  fieldLabel: {
    color: THEME.textMuted,
    flexShrink: 0 as const,
    marginRight: '12px',
  },
  fieldValue: {
    color: THEME.text,
    textAlign: 'right' as const,
    wordBreak: 'break-word' as const,
  },
  categoryBadge: {
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: '12px',
    fontSize: '11px',
    fontWeight: 500 as const,
  },
  link: {
    color: THEME.accent,
    textDecoration: 'none',
    fontSize: '13px',
  },
  attribution: {
    fontSize: '11px',
    color: THEME.textMuted,
    fontStyle: 'italic' as const,
    marginTop: '16px',
    paddingTop: '12px',
    borderTop: `1px solid ${THEME.bgTertiary}`,
  },
  listItem: {
    fontSize: '13px',
    color: THEME.text,
    padding: '3px 0',
    paddingLeft: '12px',
    position: 'relative' as const,
  },
} as const;

function DetailField({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div style={styles.field}>
      <span style={styles.fieldLabel}>{label}</span>
      <span style={styles.fieldValue}>{value}</span>
    </div>
  );
}

export const POIDetail: React.FC<POIDetailProps> = ({ poi, onClose }) => {
  const categoryLabel = POI_CATEGORY_LABELS[poi.category] ?? poi.category;
  const categoryColor = POI_CATEGORY_COLORS[poi.category] ?? THEME.accent;

  // Access potential extra properties from the API response
  const poiData = poi as unknown as Record<string, unknown>;
  const eventFacilities = poiData.event_facilities as string[] | undefined;
  const unitCount = poiData.unit_count as number | undefined;

  const isHotel = poi.subcategory?.toLowerCase().includes('hotel');
  const isMotel = poi.subcategory?.toLowerCase().includes('motel');

  return (
    <div style={styles.overlay} role="dialog" aria-label="POI details">
      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
      `}</style>

      <div style={styles.header}>
        <h2 style={styles.headerTitle}>{poi.name}</h2>
        <button
          style={styles.closeBtn}
          onClick={onClose}
          aria-label="Close panel"
        >
          &times;
        </button>
      </div>

      <div style={styles.content}>
        {/* Category Badge */}
        <div style={{ marginBottom: '12px' }}>
          <span
            style={{
              ...styles.categoryBadge,
              background: `${categoryColor}22`,
              color: categoryColor,
            }}
          >
            {categoryLabel}
          </span>
          {poi.subcategory && (
            <span
              style={{
                ...styles.categoryBadge,
                background: `${THEME.bgTertiary}`,
                color: THEME.textMuted,
                marginLeft: '6px',
              }}
            >
              {poi.subcategory}
            </span>
          )}
        </div>

        {/* Details */}
        <div style={styles.section}>
          <div style={styles.sectionTitle}>Details</div>
          <DetailField label="Address" value={poi.address} />
          <DetailField label="Phone" value={poi.phone} />
          {poi.website && (
            <div style={styles.field}>
              <span style={styles.fieldLabel}>Website</span>
              <a
                href={poi.website.startsWith('http') ? poi.website : `https://${poi.website}`}
                target="_blank"
                rel="noopener noreferrer"
                style={styles.link}
              >
                Visit
              </a>
            </div>
          )}
        </div>

        {/* Description */}
        {poi.description && (
          <div style={styles.section}>
            <div style={styles.sectionTitle}>Description</div>
            <p style={{ fontSize: '13px', color: THEME.text, lineHeight: 1.5, margin: 0 }}>
              {poi.description}
            </p>
          </div>
        )}

        {/* Hotel: Event Facilities */}
        {isHotel && eventFacilities && eventFacilities.length > 0 && (
          <div style={styles.section}>
            <div style={styles.sectionTitle}>Event Facilities</div>
            {eventFacilities.map((facility, i) => (
              <div key={i} style={styles.listItem}>
                &bull; {facility}
              </div>
            ))}
          </div>
        )}

        {/* Motel: Unit Count */}
        {isMotel && unitCount !== undefined && (
          <div style={styles.section}>
            <DetailField label="Units" value={unitCount} />
          </div>
        )}

        {/* Source Attribution */}
        <div style={styles.attribution}>
          via OpenStreetMap
        </div>
      </div>
    </div>
  );
};
