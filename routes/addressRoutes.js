// routes/addressRoutes.js

import express from "express";
import {
  saveAddress,
  updateAddress,
  listAddresses,
  softDeleteAddress,
  setDefaultAddress,
  checkPincodeServiceability,
  listPincodes,
  createPincode,
  updatePincode,
  deletePincode,
  createPincodesBatch,
  reverseGeocodeController
} from "../controllers/addressController.js";
// 🟢 Import new cache key builder
import { cache } from "../cacheMiddleware.js";
import { makeUserAddressesKey } from "../cacheKeys.js";

const router = express.Router();

// 🟢 Caching the GET route for user addresses dynamically.
router.get(
  "/user/:userId",
  cache((req) => makeUserAddressesKey(req.params.userId), 300),
  listAddresses
);

// 🟢 Post route to create a new address.
// Invalidation is handled inside the 'saveAddress' controller.
router.post("/", saveAddress);

// 🟢 Put route to update an existing address.
// Invalidation is handled inside the 'updateAddress' controller.
router.put("/:id", updateAddress);

// 🟢 Delete route to soft delete an address.
// Invalidation is handled inside the 'softDeleteAddress' controller.
router.delete("/:id", softDeleteAddress);

// 🟢 Put route to set a default address.
// Invalidation is handled inside the 'setDefaultAddress' controller.
router.put("/:id/default", setDefaultAddress);

// --- Admin Pincode Management ---
router.get("/pincodes", listPincodes);
router.post("/pincodes", createPincode);
router.put("/pincodes/:pincode", updatePincode);
router.delete("/pincodes/:pincode", deletePincode);
router.post("/pincodes/batch", createPincodesBatch);

// --- Customer Facing Pincode Check ---
router.get("/pincode/:pincode", checkPincodeServiceability);
router.get("/reverse-geocode", reverseGeocodeController);

export default router;