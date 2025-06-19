import { IUser } from '../types/iamInterfaces';
import { userCacheService } from './userCacheService';

export const getUsersDetails = async (userIds: string[], tenantId: string): Promise<IUser[]> => {
  try {
    const users = await userCacheService.getUsers(userIds, tenantId);
    return users;
  } catch (error) {
    console.error(`Error fetching users:`, error);
    return [];
  }
}; 