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
  createPincodesBatch,
  updatePincode,
  deletePincode,
  reverseGeocodeController,
  // 🟢 NEW IMPORTS
  searchCitiesByState, 
  listPincodesByStateAndCityDB
} from "../controllers/addressController.js";

// Import cache middleware
import { cache } from "../cacheMiddleware.js";
import { makeUserAddressesKey } from "../cacheKeys.js";

const router = express.Router();

// --- User Address Management ---
router.get("/user/:userId", cache((req) => makeUserAddressesKey(req.params.userId), 300), listAddresses);
router.post("/", saveAddress);
router.put("/:id", updateAddress);
router.delete("/:id", softDeleteAddress);
router.put("/:id/default", setDefaultAddress);


// --- 🟢 ADMIN PINCODE MANAGEMENT (TAB 1: Bulk Import/Add) ---

// Route 1.1: Search cities using Google API, filtered by query/state context
router.get("/pincodes/search-cities/:state/:query", searchCitiesByState);
// Route 1.2: Bulk insert/update pincodes + rules
router.post("/pincodes/batch", createPincodesBatch);


// --- 🟢 ADMIN PINCODE MANAGEMENT (TAB 2: Management/CRUD) ---

// Route 2.1: Get all saved data, grouped by state/city (The master list for Tab 2)
router.get("/pincodes", listPincodes); 
// Route 2.2: Get saved data for a specific city/state (For drilling down in Tab 2)
router.get("/pincodes/:state/:city", listPincodesByStateAndCityDB); 
// Route 2.3: Update individual rule
router.put("/pincodes/:pincode", updatePincode);
// Route 2.4: Delete individual rule
router.delete("/pincodes/:pincode", deletePincode);


// --- Customer Facing Tools ---
router.get("/pincode/:pincode", checkPincodeServiceability);
router.get("/reverse-geocode", reverseGeocodeController);

export default router;

// The process of reading a local file in JavaScript is demonstrated in this video. [Read a Local File Using JavaScript](https://www.youtube.com/watch?v=a6aRu6fFaMI)