// src/middleware/auth.js
// Moved from: middleware/auth.js
import { ClerkExpressRequireAuth, ClerkExpressWithAuth } from '@clerk/clerk-sdk-node';
import { db } from '../db/client.js';
import { usersTable } from '../db/schema/users.schema.js';
import { eq } from 'drizzle-orm';

// 1. Standard Auth — ensures user is logged in via Clerk
export const requireAuth = ClerkExpressRequireAuth();
export const withAuth = ClerkExpressWithAuth();

// 2. Admin Guard — ensures user has an RBAC role
export { requireAdmin as verifyAdmin, requirePermission } from './rbac.js';
