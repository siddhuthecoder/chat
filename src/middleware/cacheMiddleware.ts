import { Request, Response, NextFunction } from 'express';
import { cacheService } from '../services/cacheService';
import { AuthenticatedRequest } from '../types/iamInterfaces';

export interface CacheMiddlewareOptions {
    ttl?: number;
    keyGenerator?: (req: Request) => string;
    condition?: (req: Request) => boolean;
    prefix?: string;
}

export const cacheMiddleware = (options: CacheMiddlewareOptions = {}) => {
    const {
        ttl = 300,
        keyGenerator = (req) => `${req.method}:${req.originalUrl}`,
        condition = () => true,
        prefix = 'api'
    } = options;

    return async (req: Request, res: Response, next: NextFunction) => {
        // Skip caching for non-GET requests or if condition is false
        if (req.method !== 'GET' || !condition(req)) {
            return next();
        }

        try {
            // const tenantId = req.headers['x-tenant-id'] as string || req.user?.tenantId;
            const tenantId = req.headers['x-tenant-id'] as string;
            const cacheKey = keyGenerator(req);

            const cachedData = await cacheService.get(cacheKey);

            if (cachedData) {
                console.log(`Cache HIT: ${cacheKey}`);
                return res.json(cachedData);
            }

            console.log(`Cache MISS: ${cacheKey}`);


            const originalJson = res.json.bind(res);


            res.json = function (body: any) {
                // Cache the response for successful requests
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    cacheService.set(cacheKey, body, { ttl, tenantId, prefix })
                        .catch(err => console.error('Failed to cache response:', err));
                }
                return originalJson(body);
            };

            next();
        } catch (error) {
            console.error('Cache middleware error:', error);
            next();
        }
    };
};