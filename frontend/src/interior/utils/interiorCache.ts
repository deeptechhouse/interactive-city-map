interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
}

class InteriorCache {
  private _cache = new Map<string, CacheEntry<unknown>>();
  private _defaultTTL = 5 * 60 * 1000; // 5 minutes

  get<T>(key: string): T | null {
    const entry = this._cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > entry.ttl) {
      this._cache.delete(key);
      return null;
    }
    return entry.data as T;
  }

  set<T>(key: string, data: T, ttl?: number): void {
    this._cache.set(key, {
      data,
      timestamp: Date.now(),
      ttl: ttl ?? this._defaultTTL,
    });
  }

  // bigo-allow: p = prefix length, a short `interior:<buildingId>:` key prefix (never input-sized); scanning every key for a prefix is the floor for a plain Map
  // O(c * p) time, O(1) space — c = cached entries; p = characters in the prefix pattern
  invalidate(pattern: string): void {
    // bigo-allow: p = prefix length, a short `interior:<buildingId>:` key prefix (never input-sized)
    // O(c * p) time, O(1) space — c = cached entries; p = characters in the prefix pattern
    for (const key of this._cache.keys()) {
      if (key.startsWith(pattern)) {
        this._cache.delete(key);
      }
    }
  }

  // O(c) time, O(1) space — c = cached entries
  clear(): void {
    this._cache.clear();
  }
}

export const interiorCache = new InteriorCache();

// Cache key builders
// O(k) time, O(k) space — k = characters in buildingId + type
export function buildCacheKey(
  buildingId: string,
  type: string,
  level?: number,
): string {
  return level !== undefined
    ? `interior:${buildingId}:${type}:${level}`
    : `interior:${buildingId}:${type}`;
}
