import { IUser } from '../types/iamInterfaces';
import * as iamService from './iamService';

interface CacheEntry {
  data: IUser | IUser[];
  updatedAt: string;
}

class UserCacheService {
  private cache: Map<string, CacheEntry> = new Map();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes in milliseconds

  private isCacheValid(entry: CacheEntry): boolean {
    const now = new Date().getTime();
    const cacheTime = new Date(entry.updatedAt).getTime();
    return now - cacheTime < this.CACHE_TTL;
  }

  async getUsers(userIds: string[], tenantId: string): Promise<IUser[]> {
    try {
      // Check if we have all users in cache
      const cachedUsers: IUser[] = [];
      const missingUserIds: string[] = [];

      for (const userId of userIds) {
        const cacheKey = `user_${userId}`;
        const cached = this.cache.get(cacheKey);

        if (cached && this.isCacheValid(cached)) {
          cachedUsers.push(cached.data as IUser);
        } else {
          missingUserIds.push(userId);
        }
      }

      // If all users were in cache, return them
      if (missingUserIds.length === 0) {
        return cachedUsers;
      }

      // Fetch missing users from IAM service
      const fetchedUsers = await iamService.getUsersByIds(missingUserIds, tenantId);

      // Update cache with fetched users
      for (const user of fetchedUsers) {
        const cacheKey = `user_${user._id}`;
        this.cache.set(cacheKey, {
          data: user,
          updatedAt: new Date().toISOString()
        });
      }

      // Combine cached and fetched users
      return [...cachedUsers, ...fetchedUsers];
    } catch (error) {
      console.error('Error in getUsers:', error);
      throw error;
    }
  }

  async getUser(userId: string, tenantId: string): Promise<IUser | null> {
    try {
      const cacheKey = `user_${userId}`;
      const cached = this.cache.get(cacheKey);

      if (cached && this.isCacheValid(cached)) {
        return cached.data as IUser;
      }

      // Fetch user from IAM service
      const user = await iamService.getUserById(userId, tenantId);

      // Update cache
      if (user) {
        this.cache.set(cacheKey, {
          data: user,
          updatedAt: new Date().toISOString()
        });
      }

      return user;
    } catch (error) {
      console.error('Error in getUser:', error);
      throw error;
    }
  }

  invalidateUser(userId: string): void {
    const cacheKey = `user_${userId}`;
    this.cache.delete(cacheKey);
  }

  invalidateAll(): void {
    this.cache.clear();
  }
}

// Export singleton instance
export const userCacheService = new UserCacheService(); 