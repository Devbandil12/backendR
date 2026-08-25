import { db } from '../db/client.js';
import { usersTable, userRolesTable, rolesTable, permissionsTable, rolePermissionsTable } from '../db/schema/index.js';
import { eq, and } from 'drizzle-orm';
import { redis } from '../config/redis.js';

export const resolveEffectivePermissions = async (clerkId) => {
  const cacheKey = `admin:permissions:${clerkId}`;
  
  // 1. Try Cache
  const cached = await redis.get(cacheKey);
  if (cached) {
    return JSON.parse(cached);
  }

  // 2. Fetch User ID
  const user = await db.query.usersTable.findFirst({
    where: eq(usersTable.clerkId, clerkId),
    columns: { id: true }
  });

  if (!user) return null;

  // 3. Fetch User Role
  const userRole = await db.select({
    roleId: userRolesTable.roleId,
    roleName: rolesTable.name,
    isSystem: rolesTable.isSystem,
    isActive: rolesTable.isActive
  })
  .from(userRolesTable)
  .innerJoin(rolesTable, eq(userRolesTable.roleId, rolesTable.id))
  .where(eq(userRolesTable.userId, user.id))
  .limit(1)
  .then(res => res[0]);

  if (!userRole || !userRole.isActive) {
    return null;
  }

  // 4. Fetch Permissions
  const permissions = await db.select({
    key: permissionsTable.key
  })
  .from(rolePermissionsTable)
  .innerJoin(permissionsTable, eq(rolePermissionsTable.permissionId, permissionsTable.id))
  .where(eq(rolePermissionsTable.roleId, userRole.roleId));

  const permKeys = permissions.map(p => p.key);

  const result = {
    role: userRole.roleName,
    isSystem: userRole.isSystem,
    permissions: permKeys
  };

  // 5. Cache (expire in 1 hour just in case, but we invalidate on changes)
  await redis.set(cacheKey, JSON.stringify(result), 'EX', 3600);

  return result;
};

export const requirePermission = (requiredPermission) => {
  return async (req, res, next) => {
    try {
      const clerkId = req.auth?.userId;
      if (!clerkId) {
        return res.status(401).json({ error: 'Unauthorized: No session found' });
      }

      const rbacData = await resolveEffectivePermissions(clerkId);
      
      if (!rbacData || !rbacData.role) {
        return res.status(403).json({ error: 'Forbidden: No role assigned' });
      }

      // Attach to req for controllers to use
      req.adminRole = rbacData.role;
      req.adminPermissions = rbacData.permissions;

      if (!rbacData.permissions.includes(requiredPermission)) {
        console.warn(`[RBAC] Access denied for ${clerkId} to ${requiredPermission}`);
        return res.status(403).json({ error: `Forbidden: Requires permission ${requiredPermission}` });
      }

      next();
    } catch (error) {
      console.error('RBAC Middleware Error:', error);
      res.status(500).json({ error: 'Internal Server Error validating permissions' });
    }
  };
};

// Replaces `verifyAdmin` to ensure they at least have a role
export const requireAdmin = async (req, res, next) => {
  try {
    const clerkId = req.auth?.userId;
    if (!clerkId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const rbacData = await resolveEffectivePermissions(clerkId);
    if (!rbacData || !rbacData.role) {
      return res.status(403).json({ error: 'Forbidden: Admin access required' });
    }

    req.adminRole = rbacData.role;
    req.adminPermissions = rbacData.permissions;
    next();
  } catch (error) {
    console.error('requireAdmin Error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

export const invalidatePermissionCache = async (clerkId) => {
  await redis.del(`admin:permissions:${clerkId}`);
};
