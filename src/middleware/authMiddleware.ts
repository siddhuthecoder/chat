import { Request, Response, NextFunction } from "express";
import * as iamService from "../services/iamService";
import { AuthenticatedRequest } from "../types/iamInterfaces";
import { requestContext } from "../utils/requestContext";
import { ensureTenantDatabaseExists } from "../services/tenantDatabaseService";
import { userCacheService } from "../services/userCacheService";



export const authMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    const tenantHeader = req.headers["x-tenant-id"] as string;
    const contextTenantHeader = req.headers["x-context-id"] as string;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      res
        .status(401)
        .json({ message: "Unauthorized request. Please login to continue. " });
      return;
    }

    const token = authHeader.split(" ")[1];
    requestContext.set({ token });

    const { valid, decoded, userTenant } = await iamService.verifyToken(token);

    if (!valid || !decoded) {
      res
        .status(401)
        .json({ message: "Unauthorized request. Please login to continue. " });
      return;
    }

    if (!userTenant.hasAccess) {
      res
        .status(401)
        .json({ message: "User does not have access to this tenant. " });
      return;
    }

    const effectiveTenantId = contextTenantHeader || decoded.tenantId;

    // userCacheService.getCachedLoginData(decoded.userId, decoded.tenantId)

    const [dbConnection, cachedUser] = await Promise.all([
      ensureTenantDatabaseExists(effectiveTenantId),
      userCacheService.getUser(decoded.userId, decoded.tenantId),
    ]);

    if (!dbConnection) {
      res.status(500).json({ message: "Database connection failed" });
      return;
    }

    if (!cachedUser) {
      res.status(401).json({ message: "User not found" });
      return;
    }

    // Set user and tenant info in request context
    requestContext.set({
      userId: decoded.userId,
      tenantId: decoded.tenantId,
      contextTenantId: contextTenantHeader ? contextTenantHeader : "",
    });

    const authReq = req as AuthenticatedRequest;
    authReq.user = {
      _id: decoded.userId,
      email: cachedUser.email,
      role: userTenant.roleId,
      tenantId: decoded.tenantId,
      contextTenantId: contextTenantHeader ? contextTenantHeader : "",
      tenantDomain: tenantHeader,
      permissions: (cachedUser?.role as any)?.permissions || [],
      ...decoded,
    };

    authReq.tenantId = decoded.tenantId;

    next();
  } catch (error) {
    console.error("Authentication error:", error);
    res.status(401).json({ message: "Authentication failed" });
  }
};

export const hasPermission = (
  user: any,
  role: any,
  moduleKeyOrName: string,
  actionName: string
): boolean => {
  if (!user || !role || !role.permissions) return false;

  const permissionMap = flattenPermissionsToMap(role.permissions);
  const mod = permissionMap[moduleKeyOrName];
  if (!mod) return false;

  const actions = mod.allowed_actions || mod.actions || [];
  return actions.some((a: any) => a.name === actionName && a.status === true);
};

type PermissionMap = Record<string, any>;

const flattenPermissionsToMap = (modules: any[]): PermissionMap => {
  const map: PermissionMap = {};
  const helper = (mods: any[]) => {
    for (const mod of mods) {
      const key = mod.module_key || mod.submodule_key;
      if (key) map[key] = mod;
      if (mod.submodules?.length) helper(mod.submodules);
    }
  };
  helper(modules);
  return map;
};

const checkPermissionInMap = (
  map: PermissionMap,
  keyOrName: string,
  action: string
): { hasFull: boolean; hasAction: boolean } => {
  const mod = map[keyOrName];
  if (!mod) return { hasFull: false, hasAction: false };

  const actions = mod.allowed_actions || mod.actions || [];
  const hasFull = actions.some(
    (a: any) => a.name === "Full Access" && a.status === true
  );
  const hasAction = actions.some(
    (a: any) => a.name === action && a.status === true
  );
  return { hasFull, hasAction };
};

export const checkPermission = (
  moduleKeyOrName: string,
  actionName: string
) => {
  return async (
    req: Request & { hasFullAccess?: boolean },
    res: Response,
    next: NextFunction
  ) => {
    const authReq = req as AuthenticatedRequest & { hasFullAccess?: boolean };
    try {
      const permissions = authReq.user?.permissions;
      if (!permissions || !Array.isArray(permissions)) {
        return res
          .status(403)
          .json({ message: "Access denied. Permissions missing" });
      }

      const permissionMap = flattenPermissionsToMap(permissions);

      const { hasFull, hasAction } = checkPermissionInMap(
        permissionMap,
        moduleKeyOrName,
        actionName
      );

      authReq.hasFullAccess = hasFull;
      if (hasFull || hasAction) return next();
    } catch (error) {
      console.error("Permission check error:", error);
    }

    return res.status(403).json({
      message: `Access denied. You need ${actionName} permission on module ${moduleKeyOrName}`,
    });
  };
};
