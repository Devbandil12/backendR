import { getSiteStatus } from '../modules/site/site.service.js';
import { db } from '../db/client.js';
import { usersTable, userRolesTable } from '../db/schema/index.js';
import { eq } from 'drizzle-orm';

/**
 * Global Site Status Middleware
 * Enforces MAINTENANCE, EMERGENCY, and COMING_SOON modes on storefront APIs.
 * Automatically allows admins and /api/admin/* paths.
 */
export const siteStatusMiddleware = async (req, res, next) => {
  try {
    // Exclude webhooks so background payment/shipping callbacks are never blocked
    if (req.path.includes('webhook') || req.path.includes('razorpay-webhook')) {
      return next();
    }

    // Exclude the site status endpoints so frontend can actually check the status
    if (req.path.startsWith('/api/site')) {
      return next();
    }

    // Completely bypass for Admin APIs
    if (req.path.startsWith('/api/admin/') || req.path.includes('/admin/')) {
      return next();
    }

    const status = await getSiteStatus();

    if (!status || status.mode === 'LIVE') {
      return next();
    }

    // For any other mode (MAINTENANCE, EMERGENCY, COMING_SOON), 
    // check if user is an admin
    let isAdmin = false;
    
    // Check Clerk Auth if present
    if (req.auth?.userId) {
      const [user] = await db.select().from(usersTable).where(eq(usersTable.clerkId, req.auth.userId));
      if (user) {
        const [roleAssignment] = await db.select()
          .from(userRolesTable)
          .where(eq(userRolesTable.userId, user.id));
          
        if (roleAssignment) {
          isAdmin = true;
        }
      }
    }

    if (isAdmin && status.bypassEnabled) {
      return next();
    }

    // Determine what to block
    const isCriticalWrite = req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH' || req.method === 'DELETE';
    const isStorefrontRoute = req.path.startsWith('/api/cart') 
      || req.path.startsWith('/api/checkout') 
      || req.path.startsWith('/api/checkout-otp')
      || req.path.startsWith('/api/payments')
      || req.path.startsWith('/api/orders') 
      || req.path.startsWith('/api/products')
      || req.path.startsWith('/api/coupons')
      || req.path.startsWith('/api/address');

    // We block critical writes and storefront reads during maintenance.
    // Allow read-only access to user profile, support, etc.
    if (status.mode === 'MAINTENANCE' || status.mode === 'EMERGENCY') {
      if (isCriticalWrite || isStorefrontRoute) {
        return res.status(503).json({
          error: 'Service Unavailable',
          message: status.message || 'The system is currently undergoing maintenance.',
          mode: status.mode,
        });
      }
    }
    
    // For COMING_SOON, block all storefront APIs (so frontend can just render the Coming Soon page)
    if (status.mode === 'COMING_SOON' && isStorefrontRoute) {
       return res.status(503).json({
          error: 'Coming Soon',
          message: status.message || 'We are launching soon.',
          mode: status.mode,
        });
    }

    next();
  } catch (error) {
    console.error('❌ siteStatusMiddleware error:', error);
    // Fail-open for the middleware so the site doesn't crash completely if Redis is down
    next();
  }
};
