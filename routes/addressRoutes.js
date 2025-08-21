// routes/addressRoutes.js

import express from "express";
import {
  saveAddress,
  updateAddress,
  listAddresses,
  softDeleteAddress,
  setDefaultAddress
} from "../controllers/addressController.js";
import { cache, invalidateCache } from "./cacheMiddleware.js";

const router = express.Router();

// 🟢 Caching the GET route for user addresses.
// A TTL of 5 minutes (300 seconds) is a good starting point.
router.get("/user/:userId", cache("user-addresses", 300), listAddresses);

// 🟢 Post route to create a new address.
// After the address is saved, invalidate the cache.
router.post("/", async (req, res, next) => {
  await saveAddress(req, res, next);
  await invalidateCache("user-addresses");
});

// 🟢 Put route to update an existing address.
// Invalidate the cache after a successful update.
router.put("/:id", async (req, res, next) => {
  await updateAddress(req, res, next);
  await invalidateCache("user-addresses");
});

// 🟢 Delete route to soft delete an address.
// Invalidate the cache after the deletion.
router.delete("/:id", async (req, res, next) => {
  await softDeleteAddress(req, res, next);
  await invalidateCache("user-addresses");
});

// 🟢 Put route to set a default address.
// This is also a data modification, so invalidate the cache.
router.put("/:id/default", async (req, res, next) => {
  await setDefaultAddress(req, res, next);
  await invalidateCache("user-addresses");
});

export default router;