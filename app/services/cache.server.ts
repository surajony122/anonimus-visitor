interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

class MemoryCache {
  private cache: Map<string, CacheEntry<any>> = new Map();
  private defaultTTL: number = 30 * 1000; // 30 seconds default

  /**
   * Retrieve cached value if present and not expired
   */
  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return entry.value as T;
  }

  /**
   * Set cached value with TTL in milliseconds
   */
  set<T>(key: string, value: T, ttlMs?: number): void {
    const ttl = ttlMs !== undefined ? ttlMs : this.defaultTTL;
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + ttl,
    });
  }

  /**
   * Fetch with cache or execute loader callback
   */
  async getOrSet<T>(key: string, loader: () => Promise<T>, ttlMs?: number): Promise<T> {
    const cached = this.get<T>(key);
    if (cached !== null && cached !== undefined) {
      return cached;
    }

    const value = await loader();
    this.set(key, value, ttlMs);
    return value;
  }

  /**
   * Invalidate specific key or keys matching prefix
   */
  invalidate(prefixOrKey: string): void {
    for (const key of this.cache.keys()) {
      if (key === prefixOrKey || key.startsWith(prefixOrKey)) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Clear entire cache
   */
  clear(): void {
    this.cache.clear();
  }
}

export const appCache = new MemoryCache();
