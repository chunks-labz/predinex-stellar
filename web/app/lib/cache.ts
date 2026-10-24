/**
 * Client-side caching utility
 * Provides in-memory caching with TTL support
 */

interface CacheEntry<T> {
  value: T;
  timestamp: number;
  ttl: number;
}

class Cache {
  private store = new Map<string, CacheEntry<unknown>>();

  /**
   * Set a value in cache with TTL
   * @param key Cache key
   * @param value Value to cache
   * @param ttl Time to live in milliseconds
   */
  set<T>(key: string, value: T, ttl: number = 5 * 60 * 1000): void {
    this.store.set(key, {
      value,
      timestamp: Date.now(),
      ttl,
    });
  }

  /**
   * Get a value from cache
   * @param key Cache key
   * @returns Cached value or undefined if expired/not found
   */
  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);

    if (!entry) {
      return undefined;
    }

    // Check if expired
    if (Date.now() - entry.timestamp > entry.ttl) {
      this.store.delete(key);
      return undefined;
    }

    return entry.value as T;
  }

  /**
   * Check if key exists and is not expired
   * @param key Cache key
   * @returns True if key exists and is valid
   */
  has(key: string): boolean {
    const entry = this.store.get(key);

    if (!entry) {
      return false;
    }

    // Check if expired
    if (Date.now() - entry.timestamp > entry.ttl) {
      this.store.delete(key);
      return false;
    }

    return true;
  }

  /**
   * Delete a value from cache
   * @param key Cache key
   */
  delete(key: string): void {
    this.store.delete(key);
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    this.store.clear();
  }

  /**
   * Get cache size
   * @returns Number of entries in cache
   */
  size(): number {
    return this.store.size;
  }

  /**
   * Get all cache keys
   * @returns Array of cache keys
   */
  keys(): string[] {
    return Array.from(this.store.keys());
  }

  /**
   * Clean up expired entries
   */
  cleanup(): void {
    const now = Date.now();
    const keysToDelete: string[] = [];

    for (const [key, entry] of this.store.entries()) {
      if (now - entry.timestamp > entry.ttl) {
        keysToDelete.push(key);
      }
    }

    keysToDelete.forEach(key => this.store.delete(key));
  }

  /**
   * Get or set value with callback
   * @param key Cache key
   * @param callback Function to get value if not cached
   * @param ttl Time to live in milliseconds
   * @returns Cached or newly fetched value
   */
  async getOrSet<T>(
    key: string,
    callback: () => Promise<T>,
    ttl: number = 5 * 60 * 1000
  ): Promise<T> {
    const cached = this.get<T>(key);

    if (cached !== undefined) {
      return cached;
    }

    const value = await callback();
    this.set(key, value, ttl);
    return value;
  }
}

// Export singleton instance
export const cache = new Cache();

/**
 * Create a scoped cache for a specific feature
 */
export function createScopedCache(prefix: string) {
  return {
    set: <T>(key: string, value: T, ttl?: number) =>
      cache.set(`${prefix}:${key}`, value, ttl),
    get: <T>(key: string) => cache.get<T>(`${prefix}:${key}`),
    has: (key: string) => cache.has(`${prefix}:${key}`),
    delete: (key: string) => cache.delete(`${prefix}:${key}`),
    clear: () => {
      const keys = cache.keys().filter(k => k.startsWith(`${prefix}:`));
      keys.forEach(k => cache.delete(k));
    },
    getOrSet: <T>(
      key: string,
      callback: () => Promise<T>,
      ttl?: number
    ) => cache.getOrSet(`${prefix}:${key}`, callback, ttl),
  };
}
