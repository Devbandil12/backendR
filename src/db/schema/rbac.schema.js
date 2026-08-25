import { pgTable, text, timestamp, boolean, integer, uuid, primaryKey } from "drizzle-orm/pg-core";
import { usersTable } from "./users.schema.js";

// Roles Table
export const rolesTable = pgTable("roles", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(), // e.g. "SUPER_ADMIN", "Marketing Manager"
  description: text("description"),
  roleType: text("role_type").notNull().default("CUSTOM"), // SYSTEM, CUSTOM
  isSystem: boolean("is_system").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  version: integer("version").notNull().default(1),
  createdBy: uuid("created_by").references(() => usersTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Permissions Table
export const permissionsTable = pgTable("permissions", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull().unique(), // e.g. "products.create"
  name: text("name").notNull(),
  group: text("group").notNull(),
  description: text("description"),
  isSystem: boolean("is_system").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Role Permissions Junction
export const rolePermissionsTable = pgTable("role_permissions", {
  roleId: uuid("role_id").references(() => rolesTable.id, { onDelete: "cascade" }).notNull(),
  permissionId: uuid("permission_id").references(() => permissionsTable.id, { onDelete: "cascade" }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.roleId, t.permissionId] })
}));

// User Roles Junction (One Primary role initially, but supports multiple if needed later)
export const userRolesTable = pgTable("user_roles", {
  userId: uuid("user_id").references(() => usersTable.id, { onDelete: "cascade" }).notNull(),
  roleId: uuid("role_id").references(() => rolesTable.id, { onDelete: "cascade" }).notNull(),
  assignedBy: uuid("assigned_by").references(() => usersTable.id, { onDelete: "set null" }),
  assignedAt: timestamp("assigned_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at"), // Optional expiry for contractors
}, (t) => ({
  pk: primaryKey({ columns: [t.userId, t.roleId] }) // Composite PK to prevent duplicate assignments of the same role
}));
