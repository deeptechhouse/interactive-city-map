import { useCallback, useEffect, useMemo, useState } from 'react';
import type { InteriorRoom } from '../../api/interior';

export interface UseFloorLevelResult {
  currentLevel: number;
  availableLevels: number[];
  levelName: (level: number) => string;
  setLevel: (level: number) => void;
}

function getLevelName(level: number): string {
  if (level < 0) return `B${Math.abs(level)}`;
  if (level === 0) return 'G';
  return `${level}F`;
}

export function useFloorLevel(rooms: InteriorRoom[]): UseFloorLevelResult {
  const [currentLevel, setCurrentLevel] = useState(0);

  const availableLevels = useMemo(() => {
    const unique = new Set<number>();
    for (const room of rooms) {
      unique.add(room.level);
    }
    return Array.from(unique).sort((a, b) => a - b);
  }, [rooms]);

  // Reset to lowest available level when available levels change
  // and current level is no longer valid
  useEffect(() => {
    if (availableLevels.length === 0) return;

    if (!availableLevels.includes(currentLevel)) {
      setCurrentLevel(availableLevels[0]);
    }
  }, [availableLevels, currentLevel]);

  const setLevel = useCallback(
    (level: number) => {
      if (availableLevels.length === 0 || availableLevels.includes(level)) {
        setCurrentLevel(level);
      }
    },
    [availableLevels],
  );

  const levelName = useCallback((level: number): string => {
    return getLevelName(level);
  }, []);

  return { currentLevel, availableLevels, levelName, setLevel };
}
