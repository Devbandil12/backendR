import { ClerkExpressRequireAuth } from '@clerk/clerk-sdk-node';
import { db } from '../configs/index.js';
import { usersTable } from '../configs/schema.js';
import { eq } from 'drizzle-orm';

// 1. Standard Auth (Ensures user is logged in via Clerk)
export const requireAuth = ClerkExpressRequireAuth();

// 2. Admin Guard (Ensures user has 'admin' role in DB)
export const verifyAdmin = async (req, res, next) => {
  try {
    // ClerkMiddleware populates req.auth
    const clerkId = req.auth.userId; 

    if (!clerkId) {
      return res.status(401).json({ error: "Unauthorized: No session found" });
    }

    // Fetch user role from DB
    const user = await db.query.usersTable.findFirst({
      where: eq(usersTable.clerkId, clerkId),
      columns: { role: true }
    });

    if (!user || user.role !== 'admin') {
      console.warn(`🛑 Admin access denied for ${clerkId}`);
      return res.status(403).json({ error: "Forbidden: Admin access required" });
    }

    next();
  } catch (error) {
    console.error("Auth Middleware Error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};