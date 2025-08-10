import express from "express";
import {
  saveAddress,
  updateAddress,
  listAddresses,
  softDeleteAddress,
  setDefaultAddress
} from "../controllers/addressController.js";

const router = express.Router();

// Create a new address
router.post("/", saveAddress);

// Update existing address by ID
router.put("/:id", updateAddress);

// Get all addresses for a user
router.get("/user/:userId", listAddresses);

// Soft delete address by ID
router.delete("/:id", softDeleteAddress);

// Set default address by ID
router.put("/:id/default", setDefaultAddress);

export default router;