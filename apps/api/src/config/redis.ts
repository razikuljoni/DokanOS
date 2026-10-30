import { Redis } from 'ioredis';
import { env } from './env.js';
import { logger } from './logger.js';

interface CacheEntry {
  value: string;
  expiresAt: number;
}

const memoryFallbackCache = new Map<string, CacheEntry>();
let redisClient: Redis | null = null;
let redisAvailable = false;

export function initRedis(): Redis | null {
  if (!env.UPSTASH_REDIS_URL || env.NODE_ENV === 'test') {
    return null;
  }

  try {
    const client = new Redis(env.UPSTASH_REDIS_URL, {
      maxRetriesPerRequest: 1,
      connectTimeout: 2500,
      lazyConnect: true,
      retryStrategy: (times: number) => {
        if (times > 2) {
          return null;
        }
        return Math.min(times * 200, 1000);
      },
    });

    client.on('ready', () => {
      redisAvailable = true;
      logger.info('Connected to Redis cache');
    });

    client.on('error', (err: Error) => {
      if (redisAvailable) {
        logger.warn('Redis connection degraded to in-memory cache fallback', {
          message: err.message,
        });
      }
      redisAvailable = false;
    });

    void client.connect().catch(() => {
      redisAvailable = false;
      logger.warn('Upstash/local Redis unreachable; using graceful in-memory cache fallback');
    });

    redisClient = client;
    return client;
  } catch (err) {
    logger.warn('Failed to initialize Redis; degrading gracefully to in-memory fallback', {
      message: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  if (redisClient && redisAvailable) {
    try {
      const raw = await redisClient.get(key);
      if (raw) {
        return JSON.parse(raw) as T;
      }
    } catch {
      // Degrade gracefully
    }
  }

  const entry = memoryFallbackCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    memoryFallbackCache.delete(key);
    return null;
  }
  return JSON.parse(entry.value) as T;
}

export async function cacheSet(key: string, value: unknown, ttlSeconds = 60): Promise<void> {
  const serialized = JSON.stringify(value);
  if (redisClient && redisAvailable) {
    try {
      await redisClient.set(key, serialized, 'EX', ttlSeconds);
    } catch {
      // Degrade gracefully
    }
  }

  memoryFallbackCache.set(key, {
    value: serialized,
    expiresAt: Date.now() + ttlSeconds * 1000,
  });
}

export async function invalidateTenantCache(tenantId: string): Promise<void> {
  const prefix = `dash:`;
  const tenantSegment = `:${tenantId}:`;

  for (const key of memoryFallbackCache.keys()) {
    if (key.startsWith(prefix) && key.includes(tenantSegment)) {
      memoryFallbackCache.delete(key);
    }
  }

  if (redisClient && redisAvailable) {
    try {
      const keys = await redisClient.keys(`dash:*:${tenantId}:*`);
      if (keys.length > 0) {
        await redisClient.del(...keys);
      }
    } catch {
      // Degrade gracefully
    }
  }
}

export function clearAllCacheForTests(): void {
  memoryFallbackCache.clear();
}
