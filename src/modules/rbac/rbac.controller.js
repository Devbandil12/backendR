import { RBACService } from './rbac.service.js';
import { db } from '../../db/client.js';
import { audit } from '../../infrastructure/audit/audit.service.js';
import { ACTOR_TYPES, AUDIT_STATUS } from '../../infrastructure/audit/audit.constants.js';
import { rolesTable } from '../../db/schema/rbac.schema.js';
import { usersTable } from '../../db/schema/users.schema.js';
import { eq } from 'drizzle-orm';

export const getAllPermissions = async (req, res) => {
  try {
    const permissions = await RBACService.getAllPermissions();
    res.json(permissions);
  } catch (error) {
    console.error('Error fetching permissions:', error);
    res.status(500).json({ error: 'Failed to fetch permissions' });
  }
};

export const getAllRoles = async (req, res) => {
  try {
    const roles = await RBACService.getAllRoles();
    res.json(roles);
  } catch (error) {
    console.error('Error fetching roles:', error);
    res.status(500).json({ error: 'Failed to fetch roles' });
  }
};

export const createRole = async (req, res) => {
  try {
    const createdByClerkId = req.auth.userId;
    const [user] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.clerkId, createdByClerkId));

    if (req.adminRole !== 'SUPER_ADMIN' && !req.adminPermissions.includes('roles.manage')) {
      await audit.log({
        actorUserId: user?.id,
        action: 'PERMISSION_DENIED',
        actorType: ACTOR_TYPES.ADMIN,
        status: AUDIT_STATUS.DENIED,
        description: 'Attempted to create role without roles.manage permission'
      });
      return res.status(403).json({ error: 'Forbidden' });
    }

    const { name, description, permissions } = req.body;
    if (!name) return res.status(400).json({ error: 'Role name is required' });

    const newRole = await RBACService.createRole({ name, description, permissions }, user?.id);
    
    await audit.log({
      actorUserId: user?.id,
      actorType: ACTOR_TYPES.ADMIN,
      action: 'ROLE_CREATED',
      resourceType: 'ROLE',
      resourceId: newRole.id,
      resourceData: newRole,
      changes: { name, permissions },
      description: `Created role ${name}`
    });
    
    res.status(201).json(newRole);
  } catch (error) {
    console.error('Error creating role:', error);
    res.status(400).json({ error: error.message });
  }
};

export const updateRole = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, permissions } = req.body;
    const [user] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.clerkId, req.auth.userId));

    await RBACService.updateRole(id, { name, description, permissions });
    
    await audit.log({
      actorUserId: user?.id,
      actorType: ACTOR_TYPES.ADMIN,
      action: 'ROLE_UPDATED',
      resourceType: 'ROLE',
      resourceId: id,
      resourceDisplayName: name || id,
      changes: { name, permissions },
      description: `Updated role ${name || id}`
    });
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error updating role:', error);
    res.status(400).json({ error: error.message });
  }
};

export const deleteRole = async (req, res) => {
  try {
    const { id } = req.params;
    const [user] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.clerkId, req.auth.userId));

    await RBACService.deleteRole(id);
    
    await audit.log({
      actorUserId: user?.id,
      actorType: ACTOR_TYPES.ADMIN,
      action: 'ROLE_DELETED',
      resourceType: 'ROLE',
      resourceId: id,
      resourceDisplayName: id,
      description: `Deleted role ${id}`
    });
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting role:', error);
    res.status(400).json({ error: error.message });
  }
};

export const getAdministrators = async (req, res) => {
  try {
    const admins = await RBACService.getAdministrators();
    res.json(admins);
  } catch (error) {
    console.error('Error fetching administrators:', error);
    res.status(500).json({ error: 'Failed to fetch administrators' });
  }
};

export const assignRole = async (req, res) => {
  try {
    const { targetClerkId, roleId } = req.body;
    const assignedByClerkId = req.auth.userId;

    if (!targetClerkId || !roleId) {
      return res.status(400).json({ error: 'targetClerkId and roleId are required' });
    }

    const [targetUser] = await db.select().from(usersTable).where(eq(usersTable.clerkId, targetClerkId));
    const [assignedByUser] = await db.select().from(usersTable).where(eq(usersTable.clerkId, assignedByClerkId));

    if (!targetUser) return res.status(400).json({ error: 'Target user not found' });
    if (!assignedByUser) return res.status(400).json({ error: 'Assigner not found' });

    // Privilege Escalation Prevention
    const [targetRole] = await db.select().from(rolesTable).where(eq(rolesTable.id, roleId));
    
    if (targetRole && targetRole.name === 'SUPER_ADMIN' && req.adminRole !== 'SUPER_ADMIN') {
      await audit.log({
        actorUserId: assignedByUser.id,
        action: 'PRIVILEGE_ESCALATION_ATTEMPT',
        actorType: ACTOR_TYPES.ADMIN,
        status: AUDIT_STATUS.DENIED,
        description: 'Attempted to assign SUPER_ADMIN role without being SUPER_ADMIN'
      });
      return res.status(403).json({ error: 'Privilege Escalation: Only SUPER_ADMIN can assign the SUPER_ADMIN role' });
    }

    await RBACService.assignRole(targetClerkId, roleId, assignedByClerkId);
    
    await audit.log({
      actorUserId: assignedByUser.id,
      actorType: ACTOR_TYPES.ADMIN,
      action: 'ROLE_ASSIGNED',
      resourceType: 'USER',
      resourceId: targetUser.id,
      resourceData: targetUser,
      metadata: { roleId, roleName: targetRole?.name || roleId },
      description: `Assigned role '${targetRole?.name || roleId}' to ${targetUser.name} (${targetUser.email})`
    });
    
    res.json({ success: true });
  } catch (error) {
    import('fs').then(fs => fs.writeFileSync('error.log', error.stack || error.message));
    res.status(400).json({ error: error.message, stack: error.stack });
  }
};
