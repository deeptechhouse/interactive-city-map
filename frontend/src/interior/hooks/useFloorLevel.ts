import { useCallback, useEffect, useMemo, useState } from 'react';
import type { InteriorRoom } from '../../api/interior';

export interface UseFloorLevelResult {
  currentLevel: number;
  availableLevels: number[];
  levelName: (level: number) => string;
  setLevel: (level: number) => void;
}

// O(1) time, O(1) space
function getLevelName(level: number): string {
  if (level < 0) return `B${Math.abs(level)}`;
  if (level === 0) return 'G';
  return `${level}F`;
}

// The level scan runs only when `rooms` changes (useMemo); other renders reuse the cached result.
// O(r + l log l) time, O(l) space — r = rooms in the building; l = distinct floor levels
export function useFloorLevel(rooms: InteriorRoom[]): UseFloorLevelResult {
  const [currentLevel, setCurrentLevel] = useState(0);

  // O(r + l log l) time, O(l) space — r = rooms scanned; l = distinct floor levels in the building
  const availableLevels = useMemo(() => {
    const unique = new Set<number>();
    // O(r) time, O(l) space — r = rooms; l = distinct floor levels
    for (const room of rooms) {
      unique.add(room.level);
    }
    return Array.from(unique).sort((a, b) => a - b);
  }, [rooms]);

  // Reset to lowest available level when available levels change
  // and current level is no longer valid
  // O(l) time, O(1) space — l = distinct floor levels (includes() scan)
  useEffect(() => {
    if (availableLevels.length === 0) return;

    if (!availableLevels.includes(currentLevel)) {
      setCurrentLevel(availableLevels[0]);
    }
  }, [availableLevels, currentLevel]);

  // O(l) time, O(1) space — l = distinct floor levels (includes() scan)
  const setLevel = useCallback(
    (level: number) => {
      if (availableLevels.length === 0 || availableLevels.includes(level)) {
        setCurrentLevel(level);
      }
    },
    [availableLevels],
  );

  // O(1) time, O(1) space
  const levelName = useCallback((level: number): string => {
    return getLevelName(level);
  }, []);

  return { currentLevel, availableLevels, levelName, setLevel };
}
