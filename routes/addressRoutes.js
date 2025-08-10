// src/routes/addressRoutes.js
import express from "express";
import { saveAddress, deleteAddress } from "../controllers/addressController.js";

const router = express.Router();

router.post("/save", saveAddress);
router.post("/delete", deleteAddress);

export default router;