import { Request, Response, NextFunction } from 'express';
import { cacheService } from '../services/cacheService';

export interface InvalidationOptions {
    patterns: string[];
    prefix?: string;
}

export const invalidateCacheMiddleware = (options: InvalidationOptions) => {
    const { patterns, prefix = 'api' } = options;

    return async (req: Request, res: Response, next: NextFunction) => {
        const tenantId = req.headers['x-tenant-id'] as string;
        // const tenantId = req.headers['x-tenant-id'] as string || req.user?.tenantId;

        // Store original response methods
        const originalJson = res.json.bind(res);
        const originalSend = res.send.bind(res);

        const invalidateCache = async () => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
                for (const pattern of patterns) {
                    try {
                        const deletedCount = await cacheService.delPattern(pattern);
                        console.log(`Invalidated ${deletedCount} cache entries for pattern: ${pattern}`);
                    } catch (error) {
                        console.error(`Failed to invalidate cache for pattern ${pattern}:`, error);
                    }
                }
            }
        };

        // Override response methods
        res.json = function (body: any) {
            invalidateCache();
            return originalJson(body);
        };

        res.send = function (body: any) {
            invalidateCache();
            return originalSend(body);
        };

        next();
    };
};
