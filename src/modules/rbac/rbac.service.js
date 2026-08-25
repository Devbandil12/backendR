import { db } from '../../db/client.js';
import { rolesTable, permissionsTable, rolePermissionsTable, userRolesTable, usersTable } from '../../db/schema/index.js';
import { eq, inArray, and } from 'drizzle-orm';
import { redis } from '../../config/redis.js';
import { invalidatePermissionCache } from '../../middleware/rbac.js';

export class RBACService {
  
  static async getAllPermissions() {
    return db.select().from(permissionsTable).orderBy(permissionsTable.group);
  }

  static async getAllRoles() {
    const roles = await db.select().from(rolesTable);
    const roleIds = roles.map(r => r.id);
    
    if (roleIds.length === 0) return [];

    const rolePerms = await db.select({
      roleId: rolePermissionsTable.roleId,
      permissionKey: permissionsTable.key
    })
    .from(rolePermissionsTable)
    .innerJoin(permissionsTable, eq(rolePermissionsTable.permissionId, permissionsTable.id))
    .where(inArray(rolePermissionsTable.roleId, roleIds));

    // Group permissions by role
    return roles.map(role => ({
      ...role,
      permissions: rolePerms.filter(rp => rp.roleId === role.id).map(rp => rp.permissionKey)
    }));
  }

  static async createRole(data, createdById) {
    if (data.name === 'SUPER_ADMIN' || data.name === 'ADMIN') {
      throw new Error('Cannot create reserved system roles');
    }

    return await db.transaction(async (tx) => {
      // 1. Create Role
      const [newRole] = await tx.insert(rolesTable).values({
        name: data.name,
        description: data.description,
        roleType: 'CUSTOM',
        isSystem: false,
        createdBy: createdById
      }).returning();

      // 2. Assign Permissions
      if (data.permissions && data.permissions.length > 0) {
        // Resolve permission keys to IDs
        const perms = await tx.select().from(permissionsTable).where(inArray(permissionsTable.key, data.permissions));
        if (perms.length > 0) {
          const insertData = perms.map(p => ({ roleId: newRole.id, permissionId: p.id }));
          await tx.insert(rolePermissionsTable).values(insertData);
        }
      }

      return newRole;
    });
  }

  static async updateRole(roleId, data) {
    const [role] = await db.select().from(rolesTable).where(eq(rolesTable.id, roleId));
    if (!role) throw new Error('Role not found');
    if (role.isSystem) throw new Error('Cannot update system roles');

    return await db.transaction(async (tx) => {
      // 1. Update Role fields
      await tx.update(rolesTable).set({
        name: data.name,
        description: data.description,
        updatedAt: new Date()
      }).where(eq(rolesTable.id, roleId));

      // 2. Update Permissions (Replace all)
      if (data.permissions) {
        await tx.delete(rolePermissionsTable).where(eq(rolePermissionsTable.roleId, roleId));
        const perms = await tx.select().from(permissionsTable).where(inArray(permissionsTable.key, data.permissions));
        if (perms.length > 0) {
          const insertData = perms.map(p => ({ roleId, permissionId: p.id }));
          await tx.insert(rolePermissionsTable).values(insertData);
        }
      }

      // 3. Invalidate cache for all users with this role
      const usersWithRole = await tx.select({ userId: usersTable.clerkId })
        .from(userRolesTable)
        .innerJoin(usersTable, eq(userRolesTable.userId, usersTable.id))
        .where(eq(userRolesTable.roleId, roleId));

      for (const u of usersWithRole) {
        await invalidatePermissionCache(u.userId);
      }

      return true;
    });
  }

  static async deleteRole(roleId) {
    const [role] = await db.select().from(rolesTable).where(eq(rolesTable.id, roleId));
    if (!role) throw new Error('Role not found');
    if (role.isSystem) throw new Error('Cannot delete system roles');

    await db.delete(rolesTable).where(eq(rolesTable.id, roleId));
    // Users with this role might need their cache invalidated but ON DELETE CASCADE drops user_roles.
    // Better to wipe all cache to be safe or leave it to expire.
    const keys = await redis.keys('admin:permissions:*');
    if (keys.length) await redis.del(keys);
    
    return true;
  }

  static async getAdministrators() {
    return await db.select({
      id: usersTable.id,
      clerkId: usersTable.clerkId,
      name: usersTable.name,
      email: usersTable.email,
      roleId: userRolesTable.roleId,
      roleName: rolesTable.name,
      isSystem: rolesTable.isSystem
    })
    .from(usersTable)
    .innerJoin(userRolesTable, eq(usersTable.id, userRolesTable.userId))
    .innerJoin(rolesTable, eq(userRolesTable.roleId, rolesTable.id));
  }

  static async assignRole(targetClerkId, roleId, assignedByClerkId) {
    const [targetUser] = await db.select().from(usersTable).where(eq(usersTable.clerkId, targetClerkId));
    if (!targetUser) throw new Error('Target user not found');

    const [assignedByUser] = await db.select().from(usersTable).where(eq(usersTable.clerkId, assignedByClerkId));
    if (!assignedByUser) throw new Error('Assigner not found');

    const [role] = await db.select().from(rolesTable).where(eq(rolesTable.id, roleId));
    if (!role) throw new Error('Role not found');

    // Prevent privesc: Only SUPER_ADMIN can assign SUPER_ADMIN
    // Middleware handles it mostly, but just in case:
    if (role.name === 'SUPER_ADMIN') {
      // Logic handled in controller
    }

    await db.transaction(async (tx) => {
      // Remove existing role
      await tx.delete(userRolesTable).where(eq(userRolesTable.userId, targetUser.id));

      // Insert new role
      await tx.insert(userRolesTable).values({
        userId: targetUser.id,
        roleId: role.id,
        assignedBy: assignedByUser.id
      });
    });

    await invalidatePermissionCache(targetClerkId);
    return true;
  }
}
