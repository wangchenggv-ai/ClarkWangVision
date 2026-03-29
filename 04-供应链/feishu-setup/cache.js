/**
 * cache.js — Local JSON cache for Feishu Bitable records
 *
 * Saves API responses to .cache/ directory. Subsequent runs read from
 * cache instead of calling the API, saving time and tokens during development.
 *
 * Usage:
 *   import { cachedListRecords, clearCache } from "./cache.js";
 *   const records = await cachedListRecords("sku", tableId, apiFetcher);
 *
 * Cache behavior:
 *   - Default TTL: 30 minutes (configurable)
 *   - --fresh flag: bypass cache, fetch from API
 *   - --cache-ttl=N: set TTL to N minutes
 *   - Cache files stored in .cache/*.json
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = resolve(__dirname, ".cache");

// Parse CLI flags
const args = process.argv.slice(2);
const FORCE_FRESH = args.includes("--fresh");
const ttlArg = args.find(a => a.startsWith("--cache-ttl="));
const TTL_MINUTES = ttlArg ? Number(ttlArg.split("=")[1]) : 30;
const TTL_MS = TTL_MINUTES * 60 * 1000;

// Ensure cache directory exists
if (!existsSync(CACHE_DIR)) {
  mkdirSync(CACHE_DIR, { recursive: true });
}

/**
 * Read cached data if fresh enough, otherwise return null.
 */
function readCache(key) {
  if (FORCE_FRESH) return null;
  const filePath = resolve(CACHE_DIR, `${key}.json`);
  if (!existsSync(filePath)) return null;
  try {
    const raw = readFileSync(filePath, "utf-8");
    const { timestamp, data } = JSON.parse(raw);
    const age = Date.now() - timestamp;
    if (age > TTL_MS) return null; // expired
    return data;
  } catch {
    return null;
  }
}

/**
 * Write data to cache.
 */
function writeCache(key, data) {
  const filePath = resolve(CACHE_DIR, `${key}.json`);
  writeFileSync(filePath, JSON.stringify({ timestamp: Date.now(), data }, null, 0), "utf-8");
}

/**
 * Fetch records with cache. If cache is valid, returns cached data.
 * Otherwise calls fetcher() and caches the result.
 *
 * @param {string} key - Cache key (e.g. "sku", "order")
 * @param {() => Promise<Array>} fetcher - Async function that fetches records
 * @returns {Promise<Array>} records
 */
export async function cachedFetch(key, fetcher) {
  const cached = readCache(key);
  if (cached !== null) {
    return cached;
  }
  const data = await fetcher();
  writeCache(key, data);
  return data;
}

/**
 * Clear all cache files.
 */
export function clearCache() {
  if (!existsSync(CACHE_DIR)) return;
  const files = readdirSync(CACHE_DIR).filter(f => f.endsWith(".json"));
  for (const f of files) {
    unlinkSync(resolve(CACHE_DIR, f));
  }
  return files.length;
}

/**
 * Get cache status for display.
 */
export function cacheStatus() {
  if (!existsSync(CACHE_DIR)) return { files: 0, fresh: FORCE_FRESH, ttl: TTL_MINUTES };
  const files = readdirSync(CACHE_DIR).filter(f => f.endsWith(".json"));
  let validCount = 0;
  for (const f of files) {
    try {
      const raw = readFileSync(resolve(CACHE_DIR, f), "utf-8");
      const { timestamp } = JSON.parse(raw);
      if (Date.now() - timestamp < TTL_MS) validCount++;
    } catch { /* ignore */ }
  }
  return { files: files.length, valid: validCount, fresh: FORCE_FRESH, ttl: TTL_MINUTES };
}
