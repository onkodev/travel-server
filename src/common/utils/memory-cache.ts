/**
 * 간단한 인메모리 TTL 캐시
 * 서비스별로 인스턴스를 생성하여 사용
 *
 * @example
 * private cache = new MemoryCache(60 * 60 * 1000); // 1시간 TTL
 * const cached = this.cache.get<MyType>('key');
 * this.cache.set('key', data);
 * this.cache.clear(); // 전체 무효화
 */
export class MemoryCache {
  private store = new Map<string, { data: unknown; expiresAt: number }>();

  constructor(
    private readonly defaultTtl: number,
    private readonly maxSize = 500,
  ) {}

  get<T>(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.data as T;
  }

  set(key: string, data: unknown, ttl?: number): void {
    if (this.store.size >= this.maxSize) {
      this.evict();
    }
    this.store.set(key, {
      data,
      expiresAt: Date.now() + (ttl ?? this.defaultTtl),
    });
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  deleteByPrefix(prefix: string): void {
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
      }
    }
  }

  clear(): void {
    this.store.clear();
  }

  private evict(): void {
    const now = Date.now();
    // 만료된 항목 먼저 제거
    for (const [key, entry] of this.store) {
      if (now > entry.expiresAt) this.store.delete(key);
    }
    // 아직 초과하면 가장 오래된 20% 제거
    if (this.store.size >= this.maxSize) {
      const oldest = [...this.store.entries()].sort(
        ([, a], [, b]) => a.expiresAt - b.expiresAt,
      );
      for (const [key] of oldest.slice(0, Math.ceil(this.maxSize * 0.2))) {
        this.store.delete(key);
      }
    }
  }
}
