// ✅ file: routes/addressRoutes.js

import express from "express";
import {
  saveAddress,
  updateAddress,
  listAddresses,
  softDeleteAddress,
  setDefaultAddress,
  checkPincodeServiceability,
  listPincodes,
  createPincodesBatch,
  updatePincode,
  deletePincode,
  reverseGeocodeController,
  searchCitiesByState, 
  listPincodesByStateAndCityDB
} from "../controllers/addressController.js";

import { db } from "../configs/index.js";
import { usersTable } from "../configs/schema.js";
import { eq } from "drizzle-orm";

// Import cache middleware
import { cache } from "../cacheMiddleware.js";
import { makeUserAddressesKey } from "../cacheKeys.js";

// 🔒 SECURITY: Import Middleware
import { requireAuth, verifyAdmin } from "../middleware/authMiddleware.js";

const router = express.Router();

/* ======================================================
   🔒 MIDDLEWARE: Resolve User & Enforce Ownership
   - Fetches DB ID using Clerk Token
   - Ensures Users can only touch their own data
====================================================== */
const resolveAndValidateUser = async (req, res, next) => {
  try {
    const requesterClerkId = req.auth.userId;
    
    // Resolve DB User
    const user = await db.query.usersTable.findFirst({
        where: eq(usersTable.clerkId, requesterClerkId),
        columns: { id: true, role: true }
    });

    if (!user) return res.status(401).json({ error: "User not found" });

    // 🟢 Inject Resolved ID into Request (Safe for Controllers)
    req.userDbId = user.id;
    req.userRole = user.role;

    // 🔒 ACL: If a route has :userId param, ensure it matches Token OR User is Admin
    if (req.params.userId && req.params.userId !== user.id && user.role !== 'admin') {
        return res.status(403).json({ error: "Forbidden: Access Denied" });
    }

    // 🔒 Spoof Protection: Force body.userId to match Token (for POST/PUT)
    if (req.body) {
        req.body.userId = user.id;
    }

    next();
  } catch (error) {
    console.error("Auth Resolution Error:", error);
    res.status(500).json({ error: "Internal Auth Error" });
  }
};

/* ======================================================
   👤 USER ADDRESS MANAGEMENT (Secured)
====================================================== */

// GET /user/:userId
router.get(
  "/user/:userId", 
  requireAuth, 
  resolveAndValidateUser, // 🔒 Checks ACL
  cache((req) => makeUserAddressesKey(req.params.userId), 300), 
  listAddresses
);

// POST / (Create Address)
router.post(
  "/", 
  requireAuth, 
  resolveAndValidateUser, // 🔒 Injects valid req.body.userId
  saveAddress
);

// PUT /:id (Update Address)
router.put(
  "/:id", 
  requireAuth, 
  resolveAndValidateUser, 
  updateAddress
);

// DELETE /:id (Soft Delete)
router.delete(
  "/:id", 
  requireAuth, 
  resolveAndValidateUser, 
  softDeleteAddress
);

// PUT /:id/default (Set Default)
router.put(
  "/:id/default", 
  requireAuth, 
  resolveAndValidateUser, 
  setDefaultAddress
);


/* ======================================================
   🛡️ ADMIN PINCODE MANAGEMENT (Strictly Secured)
====================================================== */

// TAB 1: Bulk Import/Add
router.get(
  "/pincodes/search-cities/:state/:query", 
  requireAuth, 
  verifyAdmin, 
  searchCitiesByState
);

router.post(
  "/pincodes/batch", 
  requireAuth, 
  verifyAdmin, 
  createPincodesBatch
);

// TAB 2: Management/CRUD
router.get(
  "/pincodes", 
  requireAuth, 
  verifyAdmin, 
  listPincodes
);

router.get(
  "/pincodes/:state/:city", 
  requireAuth, 
  verifyAdmin, 
  listPincodesByStateAndCityDB
);

router.put(
  "/pincodes/:pincode", 
  requireAuth, 
  verifyAdmin, 
  updatePincode
);

router.delete(
  "/pincodes/:pincode", 
  requireAuth, 
  verifyAdmin, 
  deletePincode
);


/* ======================================================
   🟢 CUSTOMER FACING TOOLS (Public)
   - Kept public for Guest Checkout / Product Page checks
====================================================== */
router.get("/pincode/:pincode", checkPincodeServiceability);
router.get("/reverse-geocode", reverseGeocodeController);

export default router;