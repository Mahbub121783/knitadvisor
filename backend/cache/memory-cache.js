/**
 * In-memory LRU cache — L1 cache layer
 * Sub-millisecond reads. 500 entries max.
 */
const { LRUCache } = require('lru-cache');

const cache = new LRUCache({
  max: 500,
  ttl: 1000 * 60 * 60 * 24,  // 24h default
  updateAgeOnGet: true,
});

module.exports = {
  get(key) {
    const val = cache.get(key);
    return val ? JSON.parse(val) : null;
  },
  set(key, value, ttlMs) {
    cache.set(key, JSON.stringify(value), { ttl: ttlMs });
  },
  has(key) { return cache.has(key); },
  del(key) { cache.delete(key); },
  clear() { cache.clear(); },
  size() { return cache.size; },
  stats() {
    return { size: cache.size, maxSize: 500 };
  },
};
