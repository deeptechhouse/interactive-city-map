import { useCallback, useEffect, useRef, useState } from 'react';
import {
  type InteriorFeature,
  type InteriorRoom,
  type InteriorSource,
  type InteriorSummary,
  type InteriorWall,
  getFeatures,
  getRooms,
  getSources,
  getSummary,
  getWalls,
} from '../../api/interior';

export interface UseInteriorDataResult {
  sources: InteriorSource[];
  rooms: InteriorRoom[];
  walls: InteriorWall[];
  features: InteriorFeature[];
  summary: InteriorSummary | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

const EMPTY_RESULT: UseInteriorDataResult = {
  sources: [],
  rooms: [],
  walls: [],
  features: [],
  summary: null,
  loading: false,
  error: null,
  refetch: () => {},
};

export function useInteriorData(
  buildingId: string | null,
  level?: number,
): UseInteriorDataResult {
  const [sources, setSources] = useState<InteriorSource[]>([]);
  const [rooms, setRooms] = useState<InteriorRoom[]>([]);
  const [walls, setWalls] = useState<InteriorWall[]>([]);
  const [features, setFeatures] = useState<InteriorFeature[]>([]);
  const [summary, setSummary] = useState<InteriorSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const buildingRef = useRef<string | null>(null);
  const fetchIdRef = useRef(0);

  // Fetch level-specific data (rooms, walls, features)
  const fetchLevelData = useCallback(
    async (id: string, lvl: number | undefined, fetchId: number) => {
      const [roomsData, wallsData, featuresData] = await Promise.all([
        getRooms(id, lvl),
        getWalls(id, lvl),
        getFeatures(id, lvl),
      ]);

      // Only update state if this fetch is still current
      if (fetchIdRef.current === fetchId) {
        setRooms(roomsData);
        setWalls(wallsData);
        setFeatures(featuresData);
      }
    },
    [],
  );

  // Fetch all data for a new building
  const fetchAllData = useCallback(
    async (id: string, lvl: number | undefined) => {
      const fetchId = ++fetchIdRef.current;
      setLoading(true);
      setError(null);

      try {
        const [summaryData, sourcesData] = await Promise.all([
          getSummary(id),
          getSources(id),
        ]);

        if (fetchIdRef.current !== fetchId) return;

        setSummary(summaryData);
        setSources(sourcesData);

        await fetchLevelData(id, lvl, fetchId);

        if (fetchIdRef.current === fetchId) {
          setLoading(false);
        }
      } catch (err) {
        if (fetchIdRef.current === fetchId) {
          setError(err instanceof Error ? err.message : 'Failed to load interior data');
          setLoading(false);
        }
      }
    },
    [fetchLevelData],
  );

  // When buildingId changes, fetch everything
  useEffect(() => {
    if (!buildingId) {
      setSources([]);
      setRooms([]);
      setWalls([]);
      setFeatures([]);
      setSummary(null);
      setError(null);
      setLoading(false);
      buildingRef.current = null;
      return;
    }

    buildingRef.current = buildingId;
    fetchAllData(buildingId, level);
  }, [buildingId]); // eslint-disable-line react-hooks/exhaustive-deps

  // When level changes (but buildingId stays the same), re-fetch level data only
  useEffect(() => {
    if (!buildingId || buildingRef.current !== buildingId) return;

    const fetchId = ++fetchIdRef.current;
    setLoading(true);
    setError(null);

    fetchLevelData(buildingId, level, fetchId)
      .then(() => {
        if (fetchIdRef.current === fetchId) {
          setLoading(false);
        }
      })
      .catch((err) => {
        if (fetchIdRef.current === fetchId) {
          setError(err instanceof Error ? err.message : 'Failed to load level data');
          setLoading(false);
        }
      });
  }, [level]); // eslint-disable-line react-hooks/exhaustive-deps

  const refetch = useCallback(() => {
    if (buildingId) {
      fetchAllData(buildingId, level);
    }
  }, [buildingId, level, fetchAllData]);

  if (!buildingId) {
    return { ...EMPTY_RESULT, refetch };
  }

  return { sources, rooms, walls, features, summary, loading, error, refetch };
}
