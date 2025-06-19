import Redis, { Cluster } from "ioredis";

interface RedisConfig {
    host: string;
    port: number;
}

let redisInstance: Redis | Cluster | null = null;

const getRedisClient = (): Redis | Cluster => {
    if (!redisInstance) {
        const isLocal = process.env.NODE_ENV === 'local';

        if (isLocal) {
            // Local development - single Redis instance
            redisInstance = new Redis({
                host: process.env.REDIS_HOST || 'localhost',
                port: parseInt(process.env.REDIS_PORT || '6379'),
                password: process.env.REDIS_PASSWORD,
                connectTimeout: 10000,
                commandTimeout: 5000,
                lazyConnect: true,
                keepAlive: 30000,
                maxRetriesPerRequest: 3,
            });
        } else {
            // All non-development environments (test, staging, prod) - Redis Cluster
            const clusterNodes: RedisConfig[] = [
                { host: process.env.REDIS_HOST_1!, port: 7000 },
                { host: process.env.REDIS_HOST_1!, port: 7001 },
                { host: process.env.REDIS_HOST_1!, port: 7002 },
                { host: process.env.REDIS_HOST_2!, port: 7003 },
                { host: process.env.REDIS_HOST_2!, port: 7004 },
                { host: process.env.REDIS_HOST_2!, port: 7005 },
            ];

            redisInstance = new Cluster(clusterNodes, {
                redisOptions: {
                    username: process.env.REDIS_USERNAME,
                    password: process.env.REDIS_PASSWORD,
                    connectTimeout: 10000,
                    lazyConnect: true,
                },
                enableReadyCheck: true,
                retryDelayOnFailover: 100,
            });
        }

        redisInstance.on('connect', () => {
            console.log('✅ Redis connected successfully');
        });

        redisInstance.on('error', (err: any) => {
            console.error('❌ Redis connection error:', err);
        });

        redisInstance.on('ready', () => {
            console.log('🚀 Redis is ready to receive commands');
        });

        console.log(`Redis Client initialized for ${isLocal ? 'local development' : 'production cluster'}`);
    }

    if (!redisInstance) {
        throw new Error('Failed to initialize Redis client');
    }

    return redisInstance;
};

export const closeRedisConnection = async (): Promise<void> => {
    if (redisInstance) {
        await redisInstance.quit();
        redisInstance = null;
        console.log('Redis connection closed');
    }
};

export default getRedisClient;