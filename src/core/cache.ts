import { createHash } from "node:crypto";

/** Small in-memory LRU. Good enough for local dev and a single-instance deploy. */
export class LruCache<V> {
  private map = new Map<string, V>();
  constructor(private readonly max = 5000) {}

  get(key: string): V | undefined {
    const v = this.map.get(key);
    if (v !== undefined) {
      this.map.delete(key);
      this.map.set(key, v);
    }
    return v;
  }

  set(key: string, value: V): void {
    this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.max) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
  }

  get size(): number {
    return this.map.size;
  }
}

export function hashKey(...parts: Array<string | undefined>): string {
  const h = createHash("sha256");
  for (const p of parts) h.update((p ?? "") + "␞");
  return h.digest("base64url").slice(0, 32);
}
