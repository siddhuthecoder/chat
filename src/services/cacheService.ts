import getRedisClient from '../config/redisClient';
export interface CacheOptions {
    ttl?: number;
    prefix?: string;
}
export class CacheService {
    private static instance: CacheService;
    private redis = getRedisClient();
    private defaultTTL = 300;
    private constructor() { }
    static getInstance(): CacheService {
        if (!CacheService.instance) {
            CacheService.instance = new CacheService();
        }
        return CacheService.instance;
    }

    async get<T>(key: string): Promise<T | null> {
        try {
            const data = await this.redis.get(key);
            return data ? JSON.parse(data) as T : null;
        } catch (error) {
            console.error('Cache get error:', error);
            return null;
        }
    }

    async set(
        key: string,
        value: any,
        options: CacheOptions & { tenantId?: string } = {}
    ): Promise<boolean> {
        try {
            const { ttl = this.defaultTTL } = options;
            const serializedValue = JSON.stringify(value);
            if (ttl > 0) {
                await this.redis.setex(key, ttl, serializedValue);
            } else {
                await this.redis.set(key, serializedValue);
            }
            return true;
        } catch (error) {
            console.error('Cache set error:', error);
            return false;
        }
    }
    async del(key: string): Promise<boolean> {
        try {
            await this.redis.del(key);
            return true;
        } catch (error) {
            console.error('Cache delete error:', error);
            return false;
        }
    }
    async delPattern(pattern: string): Promise<number> {
        try {
            const keys = await this.redis.keys(pattern);
            return keys.length > 0 ? await this.redis.del(...keys) : 0;
        } catch (error) {
            console.error('Cache delete pattern error:', error);
            return 0;
        }
    }
    async exists(key: string): Promise<boolean> {
        try {
            return (await this.redis.exists(key)) === 1;
        } catch (error) {
            console.error('Cache exists error:', error);
            return false;
        }
    }
    async getTTL(key: string): Promise<number> {
        try {
            return await this.redis.ttl(key);
        } catch (error) {
            console.error('Cache TTL error:', error);
            return -1;
        }
    }
    async incr(key: string): Promise<number> {
        try {
            return await this.redis.incr(key);
        } catch (error) {
            console.error('Cache increment error:', error);
            return 0;
        }
    }
    async setWithExpiry(
        key: string,
        value: any,
        seconds: number,
        tenantId?: string,
        prefix?: string
    ): Promise<boolean> {
        return this.set(key, value, { ttl: seconds, tenantId, prefix });
    }
}
// Exporting the singleton instance
export const cacheService = CacheService.getInstance();