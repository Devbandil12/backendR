import express from "express";
import * as AddressesController from "./addresses.controller.js";
import { resolveAndValidateUser } from "./addresses.middleware.js";
import { cache } from "../../infrastructure/cache/cache.service.js";
import { makeUserAddressesKey } from "../../infrastructure/cache/cache.keys.js";
import { requireAuth, verifyAdmin } from "../../middleware/auth.js";

const router = express.Router();

/* ======================================================
   👤 USER ADDRESS MANAGEMENT (Secured)
====================================================== */

router.get(
  "/user/:userId", 
  requireAuth, 
  resolveAndValidateUser, 
  cache((req) => makeUserAddressesKey(req.params.userId), 300), 
  AddressesController.listAddresses
);

router.post(
  "/", 
  requireAuth, 
  resolveAndValidateUser, 
  AddressesController.saveAddress
);

router.put(
  "/:id", 
  requireAuth, 
  resolveAndValidateUser, 
  AddressesController.updateAddress
);

router.delete(
  "/:id", 
  requireAuth, 
  resolveAndValidateUser, 
  AddressesController.softDeleteAddress
);

router.put(
  "/:id/default", 
  requireAuth, 
  resolveAndValidateUser, 
  AddressesController.setDefaultAddress
);

router.put(
  "/pincodes/region/update", 
  requireAuth, 
  verifyAdmin, 
  AddressesController.bulkUpdateRegion
);

router.post(
  "/pincodes/region/delete", 
  requireAuth, 
  verifyAdmin, 
  AddressesController.bulkDeleteRegion
);

/* ======================================================
   🛡️ ADMIN PINCODE MANAGEMENT (Strictly Secured)
====================================================== */

router.get(
  "/pincodes/search-cities/:state/:query", 
  requireAuth, 
  verifyAdmin, 
  AddressesController.searchCitiesByState
);

router.post(
  "/pincodes/batch", 
  requireAuth, 
  verifyAdmin, 
  AddressesController.createPincodesBatch
);

router.get(
  "/pincodes", 
  requireAuth, 
  verifyAdmin, 
  AddressesController.listPincodes
);

router.get(
  "/pincodes/:state/:city", 
  requireAuth, 
  verifyAdmin, 
  AddressesController.listPincodesByStateAndCityDB
);

router.put(
  "/pincodes/:pincode", 
  requireAuth, 
  verifyAdmin, 
  AddressesController.updatePincode
);

router.delete(
  "/pincodes/:pincode", 
  requireAuth, 
  verifyAdmin, 
  AddressesController.deletePincode
);

router.put(
  "/pincodes/bulk-update", 
  requireAuth, 
  verifyAdmin, 
  AddressesController.bulkUpdatePincodes
);

router.post( 
  "/pincodes/bulk-delete", 
  requireAuth, 
  verifyAdmin, 
  AddressesController.bulkDeletePincodes
);


/* ======================================================
   🟢 CUSTOMER FACING TOOLS (Public)
====================================================== */
router.get("/pincode/:pincode", AddressesController.checkPincodeServiceability);
router.get("/reverse-geocode", AddressesController.reverseGeocodeController);

export default router;
