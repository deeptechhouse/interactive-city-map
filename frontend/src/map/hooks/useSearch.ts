import { useCallback, useEffect, useRef, useState } from 'react';
import { apiClient } from '../../api/client';

export interface SearchResult {
  id: string;
  type: 'building' | 'poi';
  name: string;
  address: string | null;
  category: string | null;
  lng: number;
  lat: number;
}

interface SearchResponse {
  results: SearchResult[];
}

export interface UseSearchReturn {
  results: SearchResult[];
  isLoading: boolean;
  error: string | null;
  search: (query: string, category?: string, bbox?: [number, number, number, number]) => void;
  clearResults: () => void;
}

const DEBOUNCE_MS = 300;

export function useSearch(citySlug: string): UseSearchReturn {
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const clearResults = useCallback(() => {
    setResults([]);
    setError(null);
  }, []);

  const search = useCallback(
    (query: string, category?: string, bbox?: [number, number, number, number]) => {
      // Clear previous debounce timer
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }

      // Abort previous in-flight request
      if (abortRef.current) {
        abortRef.current.abort();
      }

      if (!query || query.trim().length < 2) {
        setResults([]);
        setIsLoading(false);
        setError(null);
        return;
      }

      setIsLoading(true);
      setError(null);

      timerRef.current = setTimeout(async () => {
        const controller = new AbortController();
        abortRef.current = controller;

        try {
          const params = new URLSearchParams({ q: query.trim() });
          if (category && category !== 'all') {
            params.set('category', category);
          }
          if (bbox) {
            params.set('bbox', bbox.join(','));
          }

          const data = await apiClient.get<SearchResponse>(
            `/api/cities/${citySlug}/search?${params.toString()}`,
          );

          if (!controller.signal.aborted) {
            setResults(data.results ?? []);
            setIsLoading(false);
          }
        } catch (err) {
          if (err instanceof DOMException && err.name === 'AbortError') {
            return;
          }
          if (!controller.signal.aborted) {
            setError(err instanceof Error ? err.message : 'Search failed');
            setResults([]);
            setIsLoading(false);
          }
        }
      }, DEBOUNCE_MS);
    },
    [citySlug],
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (abortRef.current) abortRef.current.abort();
    };
  }, []);

  return { results, isLoading, error, search, clearResults };
}
