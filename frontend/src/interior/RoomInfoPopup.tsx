import React from 'react';
import { THEME } from '../utils/colorSchemes';

interface RoomInfoPopupProps {
  room: {
    name: string | null;
    room_type: string | null;
    area_sqm: number | null;
    capacity: number | null;
    level: number;
  };
  position: { x: number; y: number };
  onClose: () => void;
}

const formatLevel = (level: number): string => {
  if (level < 0) return `B${Math.abs(level)}`;
  if (level === 0) return 'G';
  return `${level}F`;
};

const styles = {
  container: {
    position: 'fixed' as const,
    zIndex: 100,
    background: THEME.bgSecondary,
    border: `1px solid ${THEME.border}`,
    borderRadius: '8px',
    padding: '12px',
    maxWidth: '240px',
    boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: '8px',
    marginBottom: '8px',
  },
  title: {
    fontSize: '14px',
    fontWeight: 600,
    color: THEME.text,
    margin: 0,
  },
  closeButton: {
    background: 'none',
    border: 'none',
    color: THEME.textMuted,
    cursor: 'pointer',
    fontSize: '14px',
    lineHeight: '1',
    padding: '0 2px',
    flexShrink: 0,
  },
  row: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '12px',
    padding: '2px 0',
  },
  label: {
    color: THEME.textMuted,
  },
  value: {
    color: THEME.text,
  },
} as const;

export const RoomInfoPopup: React.FC<RoomInfoPopupProps> = ({
  room,
  position,
  onClose,
}) => {
  const title = room.name ?? room.room_type ?? 'Room';

  return (
    <div
      style={{
        ...styles.container,
        left: position.x,
        top: position.y,
        transform: 'translate(-50%, -100%)',
        marginTop: '-8px',
      }}
    >
      <div style={styles.header}>
        <h4 style={styles.title}>{title}</h4>
        <button style={styles.closeButton} onClick={onClose}>
          &times;
        </button>
      </div>
      {room.room_type && (
        <div style={styles.row}>
          <span style={styles.label}>Type</span>
          <span style={styles.value}>{room.room_type}</span>
        </div>
      )}
      {room.area_sqm != null && (
        <div style={styles.row}>
          <span style={styles.label}>Area</span>
          <span style={styles.value}>{room.area_sqm.toFixed(1)} m&sup2;</span>
        </div>
      )}
      {room.capacity != null && (
        <div style={styles.row}>
          <span style={styles.label}>Capacity</span>
          <span style={styles.value}>{room.capacity}</span>
        </div>
      )}
      <div style={styles.row}>
        <span style={styles.label}>Level</span>
        <span style={styles.value}>{formatLevel(room.level)}</span>
      </div>
    </div>
  );
};
