import { db } from "./client.js";
import { rolesTable, permissionsTable, rolePermissionsTable } from "./schema/index.js";
import { PERMISSION_REGISTRY, SYSTEM_ROLES } from "../config/permissions.registry.js";
import { eq, and } from "drizzle-orm";

export async function seedRBAC() {
  console.log("?? Seeding RBAC Configuration...");

  // 1. Seed Permissions
  for (const perm of PERMISSION_REGISTRY) {
    const existing = await db.select().from(permissionsTable).where(eq(permissionsTable.key, perm.key));
    if (existing.length === 0) {
      await db.insert(permissionsTable).values({
        key: perm.key,
        name: perm.name,
        group: perm.group,
        description: perm.description,
        isSystem: true
      });
      console.log(`   + Permission: ${perm.key}`);
    }
  }

  // 2. Seed System Roles
  const rolesToSeed = [
    { name: SYSTEM_ROLES.SUPER_ADMIN, description: "Unrestricted System Administrator", isSystem: true, roleType: "SYSTEM" },
    { name: SYSTEM_ROLES.ADMIN, description: "Standard System Administrator", isSystem: true, roleType: "SYSTEM" },
    { name: SYSTEM_ROLES.MARKETING_MANAGER, description: "Manages campaigns, coupons, and promotions", isSystem: true, roleType: "SYSTEM" },
    { name: SYSTEM_ROLES.CATALOG_MANAGER, description: "Manages products and inventory", isSystem: true, roleType: "SYSTEM" },
    { name: SYSTEM_ROLES.ORDER_MANAGER, description: "Manages and fulfills orders", isSystem: true, roleType: "SYSTEM" },
    { name: SYSTEM_ROLES.CUSTOMER_SUPPORT, description: "Manages customer inquiries and profiles", isSystem: true, roleType: "SYSTEM" },
    { name: SYSTEM_ROLES.LOGISTICS_MANAGER, description: "Manages shipping and logistics", isSystem: true, roleType: "SYSTEM" },
    { name: SYSTEM_ROLES.FINANCE_MANAGER, description: "Views financial analytics and orders", isSystem: true, roleType: "SYSTEM" },
    { name: SYSTEM_ROLES.VIEWER, description: "Read-only access to most non-sensitive data", isSystem: true, roleType: "SYSTEM" },
  ];

  for (const roleData of rolesToSeed) {
    let role = await db.select().from(rolesTable).where(eq(rolesTable.name, roleData.name)).then(res => res[0]);
    if (!role) {
      const inserted = await db.insert(rolesTable).values(roleData).returning();
      role = inserted[0];
      console.log(`   + Role: ${role.name}`);
    }

    // 3. Assign Permissions
    const allPermissions = await db.select().from(permissionsTable);

    let assignedPerms = [];

    if (role.name === SYSTEM_ROLES.SUPER_ADMIN) {
      assignedPerms = allPermissions;
    } else if (role.name === SYSTEM_ROLES.ADMIN) {
      assignedPerms = allPermissions.filter(p => p.group !== 'Administration');
    } else if (role.name === SYSTEM_ROLES.MARKETING_MANAGER) {
      assignedPerms = allPermissions.filter(p => 
        p.key.startsWith('dashboard.') || p.key.startsWith('analytics.') || p.key.startsWith('marketIntel.') ||
        p.key.startsWith('coupons.') || p.key.startsWith('referrals.') || p.key.startsWith('rewards.') || 
        p.key.startsWith('lottery.') || p.key.startsWith('messages.') || p.key.startsWith('content.')
      );
    } else if (role.name === SYSTEM_ROLES.CATALOG_MANAGER) {
      assignedPerms = allPermissions.filter(p => 
        p.key.startsWith('dashboard.') || p.key.startsWith('products.')
      );
    } else if (role.name === SYSTEM_ROLES.ORDER_MANAGER) {
      assignedPerms = allPermissions.filter(p => 
        p.key.startsWith('dashboard.') || p.key.startsWith('orders.') || 
        p.key.startsWith('carts.') || p.key.startsWith('wishlists.') || p.key.startsWith('logistics.')
      );
    } else if (role.name === SYSTEM_ROLES.CUSTOMER_SUPPORT) {
      assignedPerms = allPermissions.filter(p => 
        p.key.startsWith('dashboard.') || p.key.startsWith('customers.') || 
        p.key.startsWith('messages.') || p.key === 'orders.view'
      );
    } else if (role.name === SYSTEM_ROLES.LOGISTICS_MANAGER) {
      assignedPerms = allPermissions.filter(p => 
        p.key.startsWith('dashboard.') || p.key.startsWith('logistics.') || p.key === 'orders.view'
      );
    } else if (role.name === SYSTEM_ROLES.FINANCE_MANAGER) {
      assignedPerms = allPermissions.filter(p => 
        p.key.startsWith('dashboard.') || p.key.startsWith('analytics.') || 
        p.key === 'orders.view' || p.key === 'orders.export' || p.key === 'auditLogs.export'
      );
    } else if (role.name === SYSTEM_ROLES.VIEWER) {
      assignedPerms = allPermissions.filter(p => p.key.endsWith('.view'));
    }

    // Insert permissions if not already present
    for (const perm of assignedPerms) {
      const existingRel = await db.select().from(rolePermissionsTable)
        .where(and(eq(rolePermissionsTable.roleId, role.id), eq(rolePermissionsTable.permissionId, perm.id)));
      if (existingRel.length === 0) {
        try {
          await db.insert(rolePermissionsTable).values({ roleId: role.id, permissionId: perm.id });
        } catch(e) {}
      }
    }
  }

  console.log("? RBAC Seeding Complete!");
}

// Allow direct execution
if (process.argv[1] === new URL(import.meta.url).pathname || process.argv[1] === import.meta.url) {
  seedRBAC().then(() => process.exit(0)).catch(console.error);
}
