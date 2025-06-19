import axios from 'axios';
import https from 'https';
import { requestContext } from '../utils/requestContext';
import { IUser } from '../types/iamInterfaces';
import dotenv from 'dotenv';

dotenv.config();

// Configure environment variables for IAM service
const IAM_SERVICE_URL = process.env.IAM_SERVICE_URL;

// Define response types
interface TokenResponse {
  valid: boolean;
  decoded?: any;
  userTenant: any;
}

interface UserUpdateResponse {
  latestUpdate: string;
}

interface IAMUserResponse {
  _id: string;
  firstname?: string;
  lastname?: string;
  email: string;
  phone?: string;
  profile_image?: string;
  roles?: string[];
  updatedAt?: string;
}

interface UsersResponse {
  users: IUser[];
}

interface TenantAccessResponse {
  hasAccess: boolean;
}

// Create axios instance
const axiosConfig = {
  baseURL: IAM_SERVICE_URL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
  // @ts-ignore - httpsAgent is valid but not in type definition
  httpsAgent: new https.Agent({ rejectUnauthorized: true })
};

export const iamClient = axios.create(axiosConfig);

// Interceptor to include Authorization header if token is in context
iamClient.interceptors.request.use((config) => {
  const { token } = requestContext.get();

  if (token) {
    config.headers = config.headers || {};
    config.headers.Authorization = `Bearer ${token}`;
  }

  return config;
});

// Handle IAM service errors
export const handleIamError = (error: unknown): never => {
  const axiosError = error as any;
  if (axiosError?.isAxiosError) {
    if (axiosError.response) {
      throw new Error(`IAM Service Error (${axiosError.response.status}): ${JSON.stringify(axiosError.response.data)}`);
    } else if (axiosError.request) {
      throw new Error(`IAM Service Unreachable: ${axiosError.message}`);
    }
  }
  throw error;
};

// User cache for performance
const userCache = new Map();

// Verify token with IAM service
export const verifyToken = async (token: string): Promise<{ valid: boolean, decoded?: any, userTenant: any }> => {
  try {
    const response = await iamClient.post<TokenResponse>('/auth/verify-token', { token });
    return response.data;
  } catch (error) {
    return handleIamError(error);
  }
};

// Get user by ID with caching
export const getUserById = async (userId: string, tenantId: string): Promise<IUser> => {
  try {
    const cacheKey = `user_${userId}`;

    // Check cache first
    const cached = userCache.get(cacheKey);

    // If we have a cached version, check if it's still fresh
    if (cached) {
      // Get latest update time for this specific user
      const userUpdateCheck = await iamClient.get<UserUpdateResponse>(`/users/${userId}/latest-update`);
      const latestUpdateTime = userUpdateCheck.data.latestUpdate;

      if (cached.updatedAt >= latestUpdateTime) {
        return cached.data as IUser;
      }
    }

    // Cache miss or stale data - fetch from IAM service
    const response = await iamClient.get<IAMUserResponse>(`/users/${userId}?tenantId=${tenantId}`);

    // Update cache with the new data
    userCache.set(cacheKey, {
      data: response.data,
      updatedAt: response.data.updatedAt || new Date().toISOString()
    });

    return response.data as IUser;
  } catch (error) {
    return handleIamError(error);
  }
};

// Get multiple users by IDs
export const getUsersByIds = async (userIds: string[], tenantId: string): Promise<IUser[]> => {
  try {
    const response = await iamClient.post<UsersResponse>(`/users/bulk`, {
      userIds,
      tenantId
    });
    return response.data.users || [];
  } catch (error) {
    return handleIamError(error);
  }
};

// Verify tenant access
export const verifyTenantAccess = async (userId: string, tenantId: string): Promise<boolean> => {
  try {
    const response = await iamClient.post<TenantAccessResponse>('/auth/verify-tenant-access', {
      userId,
      tenantId
    });
    return response.data.hasAccess;
  } catch (error) {
    const axiosError = error as any;
    if (axiosError?.isAxiosError && axiosError.response?.status === 403) {
      return false;
    }
    return handleIamError(error);
  }
};

// Get user permissions in a specific tenant
export const getUserPermissions = async (userId: string, tenantId: string): Promise<any> => {
  try {
    const response = await iamClient.get(`/users/${userId}/permissions?tenantId=${tenantId}`);
    return response.data;
  } catch (error) {
    return handleIamError(error);
  }
};

// Invalidate user cache
export const invalidateUserCache = (userId?: string): void => {
  if (userId) {
    userCache.delete(`user_${userId}`);
  }
};

// Get user details from IAM service
export const getUserDetails = async (userId: string, tenantId: string): Promise<IUser | null> => {
  try {
    const response = await iamClient.get<IAMUserResponse>(`/users/${userId}`, {
      headers: {
        'x-tenant-id': tenantId,
        'Authorization': `Bearer ${requestContext.get().token}`
      }
    });


    if (!response.data) {
      return null;
    }

    const user: any = response.data;

    const result = {
      _id: user._id,
      firstname: user.firstname,
      lastname: user.lastname,
      email: user.email,
      phone: user.phone,
      profile_image: user.profile_image,
      role: user.roles?.[0] as any,
      status: user.status as any,
      team: user.team as any,
      company: user.company as any,
      can_change_permissions: user.can_change_permissions as any,
      photo_image: user.profile_image || null,
      displayName: `${user.firstname || ''} ${user.lastname || ''}`.trim(),
      phoneNumber: user.phone,
      web_device_token: user.web_device_token,
      mobile_device_token: user.mobile_device_token
    };

    return result;
  } catch (error) {
    console.error('🔍 [getUserDetails] Error fetching user details:', error);
    return null;
  }
};

export const getUserDetailsByToken = async (userId: string, tenantId: string, token: string): Promise<IUser | null> => {
  try {
    if (!token) {
      return null;
    }
    const response = await iamClient.get<IAMUserResponse>(`/users/${userId}`, {
      headers: {
        'x-tenant-id': tenantId,
        'Authorization': `Bearer ${token}`
      }
    });


    if (!response.data) {
      return null;
    }

    const user: any = response.data;

    const result = {
      _id: user._id,
      firstname: user.firstname,
      lastname: user.lastname,
      email: user.email,
      phone: user.phone,
      profile_image: user.profile_image,
      role: user.roles?.[0] as any,
      status: user.status as any,
      team: user.team as any,
      company: user.company as any,
      can_change_permissions: user.can_change_permissions as any,
      photo_image: user.profile_image || null,
      displayName: `${user.firstname || ''} ${user.lastname || ''}`.trim(),
      phoneNumber: user.phone,
      web_device_token: user.web_device_token,
      mobile_device_token: user.mobile_device_token
    };

    return result;
  } catch (error) {
    console.error('🔍 [getUserDetails] Error fetching user details:', error);
    return null;
  }
};

// Get multiple users' details from IAM service
export const getUsersDetails = async (userIds: string[], tenantId: string): Promise<IUser[]> => {
  try {
    const response = await iamClient.post<IAMUserResponse[]>('/users/bulk', {
      userIds,
      tenantId
    }, {
      headers: {
        'x-tenant-id': tenantId,
        'Authorization': `Bearer ${requestContext.get().token}`
      }
    });
    if (!response.data || !Array.isArray(response.data)) return [];

    const result = response.data.map((user: any) => ({
      _id: user._id,
      firstname: user.firstname,
      lastname: user.lastname,
      email: user.email,
      phone: user.phone,
      profile_image: user.profile_image,
      role: user.roles?.[0] as any,
      status: user.status as any,
      team: user.team as any,
      company: user.company as any,
      can_change_permissions: user.can_change_permissions as any,
      updatedAt: user.updatedAt || new Date().toISOString(),
      photo_image: user.profile_image,
      displayName: `${user.firstname || ''} ${user.lastname || ''}`.trim(),
      phoneNumber: user.phone,
      web_device_token: user.web_device_token,
      mobile_device_token: user.mobile_device_token
    }));

    return result;
  } catch (error) {
    console.error('🔍 [getUsersDetails] Error fetching users details:');
    return [];
  }
};
export const getUsersDetailsByToken = async (userIds: string[], tenantId: string, token: string): Promise<IUser[]> => {
  try {
    if (!token) {
      return [];
    }
    const response = await iamClient.post<IAMUserResponse[]>('/users/bulk', {
      userIds,
      tenantId
    }, {
      headers: {
        'x-tenant-id': tenantId,
        'Authorization': `Bearer ${token}`
      }
    });
    if (!response.data || !Array.isArray(response.data)) return [];

    const result = response.data.map((user: any) => ({
      _id: user._id,
      firstname: user.firstname,
      lastname: user.lastname,
      email: user.email,
      phone: user.phone,
      profile_image: user.profile_image,
      role: user.roles?.[0] as any,
      status: user.status as any,
      team: user.team as any,
      company: user.company as any,
      can_change_permissions: user.can_change_permissions as any,
      updatedAt: user.updatedAt || new Date().toISOString(),
      photo_image: user.profile_image,
      displayName: `${user.firstname || ''} ${user.lastname || ''}`.trim(),
      phoneNumber: user.phone,
      web_device_token: user.web_device_token,
      mobile_device_token: user.mobile_device_token
    }));

    return result;
  } catch (error) {
    console.error('🔍 [getUsersDetails1 by token] Error fetching users details:');
    return [];
  }
}; 