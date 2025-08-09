import express from "express";
import {
  saveAddress,
  updateAddress,
  listAddresses,
  softDeleteAddress,
  setDefaultAddress
} from "../controllers/addressController.js";

const router = express.Router();

router.post("/save", saveAddress);
router.put("/update/:id", updateAddress);
router.get("/list/:userId", listAddresses);
router.delete("/soft-delete/:id", softDeleteAddress);
router.put("/set-default/:id", setDefaultAddress);

export default router;
