import React, { useCallback, useState } from 'react';
import type { Building, BuildingUpdate } from '../types/building';
import { updateBuilding } from '../api/buildings';
import { THEME } from '../utils/colorSchemes';

interface BuildingDetailProps {
  building: Building;
  onClose: () => void;
  onBuildingUpdated?: (building: Building) => void;
  onViewInterior?: (buildingId: string) => void;
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
  badge: {
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: '12px',
    fontSize: '11px',
    fontWeight: 500 as const,
  },
  interiorBadge: {
    background: 'rgba(63, 185, 80, 0.15)',
    color: THEME.success,
  },
  link: {
    color: THEME.accent,
    textDecoration: 'none',
    fontSize: '13px',
  },
  toggleBtn: {
    width: '100%',
    padding: '8px 12px',
    borderRadius: '6px',
    border: `1px solid ${THEME.border}`,
    fontSize: '13px',
    cursor: 'pointer',
    fontWeight: 500 as const,
    transition: 'all 0.15s ease',
  },
  toggleBtnActive: {
    background: THEME.bgSecondary,
    color: THEME.text,
  },
  toggleBtnDanger: {
    background: 'rgba(248, 81, 73, 0.1)',
    color: THEME.danger,
    borderColor: THEME.danger,
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

export const BuildingDetail: React.FC<BuildingDetailProps> = ({
  building,
  onClose,
  onBuildingUpdated,
  onViewInterior,
}) => {
  const [isHiding, setIsHiding] = useState(false);

  const handleToggleHidden = useCallback(async () => {
    setIsHiding(true);
    try {
      const update: BuildingUpdate = { is_hidden: !building.is_hidden };
      const updated = await updateBuilding(building.id, update);
      onBuildingUpdated?.(updated);
    } catch (err) {
      console.error('Failed to update building visibility:', err);
    } finally {
      setIsHiding(false);
    }
  }, [building.id, building.is_hidden, onBuildingUpdated]);

  const externalLinks: Record<string, string> = {};
  const props = building as unknown as Record<string, unknown>;
  if (props.external_links && typeof props.external_links === 'object') {
    const links = props.external_links as Record<string, string>;
    if (links.assessor) externalLinks.assessor = links.assessor;
    if (links.loopnet) externalLinks.loopnet = links.loopnet;
  }

  return (
    <div style={styles.overlay} role="dialog" aria-label="Building details">
      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
      `}</style>

      <div style={styles.header}>
        <h2 style={styles.headerTitle}>
          {building.name ?? building.address ?? 'Building Details'}
        </h2>
        <button
          style={styles.closeBtn}
          onClick={onClose}
          aria-label="Close panel"
        >
          &times;
        </button>
      </div>

      <div style={styles.content}>
        {/* Badges */}
        {building.has_interior && (
          <div style={{ marginBottom: '16px' }}>
            <span style={{ ...styles.badge, ...styles.interiorBadge }}>
              Has Interior Map
            </span>
            <button
              style={{
                ...styles.toggleBtn,
                ...styles.toggleBtnActive,
                marginTop: '8px',
                background: 'rgba(88, 166, 255, 0.15)',
                color: THEME.accent,
                borderColor: THEME.accent,
              }}
              onClick={() => onViewInterior?.(building.id)}
            >
              View Interior
            </button>
          </div>
        )}

        {/* Basic Info */}
        <div style={styles.section}>
          <div style={styles.sectionTitle}>Details</div>
          <DetailField label="Address" value={building.address} />
          <DetailField label="Name" value={building.name} />
          <DetailField label="Type" value={building.building_type} />
          <DetailField label="Style" value={building.style} />
          <DetailField label="Architect" value={building.architect} />
          <DetailField label="Year Built" value={building.year_built} />
          {building.year_demolished && (
            <DetailField label="Year Demolished" value={building.year_demolished} />
          )}
          <DetailField label="Stories" value={building.stories} />
        </div>

        {/* Description */}
        {building.description && (
          <div style={styles.section}>
            <div style={styles.sectionTitle}>Description</div>
            <p style={{ fontSize: '13px', color: THEME.text, lineHeight: 1.5, margin: 0 }}>
              {building.description}
            </p>
          </div>
        )}

        {/* External Links */}
        {Object.keys(externalLinks).length > 0 && (
          <div style={styles.section}>
            <div style={styles.sectionTitle}>External Links</div>
            {externalLinks.assessor && (
              <div style={{ padding: '4px 0' }}>
                <a
                  href={externalLinks.assessor}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={styles.link}
                >
                  County Assessor Record
                </a>
              </div>
            )}
            {externalLinks.loopnet && (
              <div style={{ padding: '4px 0' }}>
                <a
                  href={externalLinks.loopnet}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={styles.link}
                >
                  LoopNet Listing
                </a>
              </div>
            )}
          </div>
        )}

        {/* Actions */}
        <div style={styles.section}>
          <div style={styles.sectionTitle}>Actions</div>
          <button
            style={{
              ...styles.toggleBtn,
              ...(building.is_hidden ? styles.toggleBtnActive : styles.toggleBtnDanger),
            }}
            onClick={handleToggleHidden}
            disabled={isHiding}
          >
            {isHiding
              ? 'Updating...'
              : building.is_hidden
                ? 'Show on Map'
                : 'Remove from Map'}
          </button>
        </div>
      </div>
    </div>
  );
};
