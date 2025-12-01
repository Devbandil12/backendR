// src/routes/addressRoutes.js

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
  reverseGeocodeController,
  fetchGooglePincodes,
  searchGoogleCities // 🟢 NEW IMPORT
} from "../controllers/addressController.js";

// Import cache middleware
import { cache } from "../cacheMiddleware.js";
import { makeUserAddressesKey } from "../cacheKeys.js";

const router = express.Router();

// --- User Address Management ---

// GET user addresses (Cached)
router.get(
  "/user/:userId",
  cache((req) => makeUserAddressesKey(req.params.userId), 300),
  listAddresses
);

// POST create address
router.post("/", saveAddress);

// PUT update address
router.put("/:id", updateAddress);

// DELETE address
router.delete("/:id", softDeleteAddress);

// PUT set default address
router.put("/:id/default", setDefaultAddress);


// --- Admin Pincode Management ---

router.get("/pincodes", listPincodes);
router.post("/pincodes", createPincode);
router.put("/pincodes/:pincode", updatePincode);
router.delete("/pincodes/:pincode", deletePincode);
router.post("/pincodes/batch", createPincodesBatch);

// 🟢 NEW ROUTE: Fetch pincodes from Google Places API
router.get("/google-fetch/:city", fetchGooglePincodes);
// 🟢 NEW ROUTE: Search cities via Google
router.get("/google-cities/:query", searchGoogleCities);

// --- Customer Facing Tools ---

router.get("/pincode/:pincode", checkPincodeServiceability);
router.get("/reverse-geocode", reverseGeocodeController);

export default router;