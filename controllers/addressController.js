// src/controllers/addressController.js
import { db } from '../configs/index.js';
import { UserAddressTable, pincodeServiceabilityTable } from '../configs/schema.js';
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import fetch from "node-fetch";
// Import new helpers
import { invalidateMultiple } from "../invalidateHelpers.js";
import { makeUserAddressesKey } from "../cacheKeys.js";

// Reverse Geocode helper to fill missing address details from lat/lng
async function reverseGeocode(lat, lng) {
  if (!lat || !lng) return {};
  const res = await fetch(
    `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${process.env.GOOGLE_API_KEY}`
  );
  const data = await res.json();
  // ✅ ADD THIS LINE TO DEBUG
  console.log("Google Maps API Response:", data);
  if (data.results?.[0]) {
    const updated = {};
    data.results[0].address_components.forEach(c => {
      if (c.types.includes("postal_code")) updated.postalCode = c.long_name;
      if (c.types.includes("locality")) updated.city = c.long_name;
      if (c.types.includes("administrative_area_level_1")) updated.state = c.long_name;
      if (c.types.includes("country")) updated.country = c.long_name;
    });
    updated.address = data.results[0].formatted_address;
    return updated;
  }
  return {};
}
export async function reverseGeocodeController(req, res) {
  const { lat, lon } = req.query;

  if (!lat || !lon) {
    return res.status(400).json({ success: false, msg: "Latitude and longitude are required." });
  }

  try {
    const geoData = await reverseGeocode(lat, lon);
    
    // The reverseGeocode helper returns an empty object on failure, which is fine.
    // We just forward the result to the frontend.
    return res.json(geoData);

  } catch (error) {
    console.error("Reverse geocode controller error:", error);
    return res.status(500).json({ success: false, msg: "Server error during reverse geocoding." });
  }
}
// POST /api/address/save
export async function saveAddress(req, res) {
  try {
    let {
      userId, name, phone, altPhone, address, city, state, postalCode, country,
      landmark, deliveryInstructions, addressType = "Home", label,
      latitude, longitude, geoAccuracy,
      isDefault = false, isVerified = false, isDeleted = false
    } = req.body;

    // Validate required fields
    if (!userId || !name || !phone) {
      return res.status(400).json({ success: false, msg: "Missing required fields: userId, name, or phone" });
    }

    // Reverse geocode if address incomplete but lat/lng present
    if ((!address || !city || !state || !postalCode || !country) && latitude && longitude) {
      const geoData = await reverseGeocode(latitude, longitude);
      address = address || geoData.address;
      city = city || geoData.city;
      state = state || geoData.state;
      postalCode = postalCode || geoData.postalCode;
      country = country || geoData.country;
    }

    // Final check for address completeness
    if (!address || !city || !state || !postalCode || !country) {
      return res.status(400).json({ success: false, msg: "Incomplete address details after geocoding" });
    }

    // If setting this as default, clear default from other addresses for user
    if (isDefault) {
      await db
        .update(UserAddressTable)
        .set({ isDefault: false })
        .where(eq(UserAddressTable.userId, userId));
    }

    const inserted = await db
      .insert(UserAddressTable)
      .values({
        userId,
        name: name.trim(),
        phone: phone.trim(),
        altPhone: altPhone?.trim() || null,
        address: address.trim(),
        city: city.trim(),
        state: state.trim(),
        postalCode: postalCode.trim(),
        country: country.trim(),
        landmark: landmark?.trim() || null,
        deliveryInstructions: deliveryInstructions?.trim() || null,
        addressType,
        label: label?.trim() || null,
        latitude: latitude?.toString() || null,
        longitude: longitude?.toString() || null,
        geoAccuracy: geoAccuracy?.toString() || null,
        isDefault,
        isVerified,
        isDeleted,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      .returning();
    
    // Invalidate user's address list cache
    await invalidateMultiple([{ key: makeUserAddressesKey(userId) }]);

    return res.json({ success: true, msg: "Address saved successfully", data: inserted[0] });
  } catch (err) {
    console.error("saveAddress error:", err);
    return res.status(500).json({ success: false, msg: "Server error" });
  }
}

// PUT /api/address/update/:id
export async function updateAddress(req, res) {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ success: false, msg: "Missing address ID" });

    let {
      name, phone, altPhone, address, city, state, postalCode, country,
      landmark, deliveryInstructions, addressType, label,
      latitude, longitude, geoAccuracy,
      isDefault, isVerified, isDeleted
    } = req.body;

    // Reverse geocode if needed
    if ((!address || !city || !state || !postalCode || !country) && latitude && longitude) {
      const geoData = await reverseGeocode(latitude, longitude);
      address = address || geoData.address;
      city = city || geoData.city;
      state = state || geoData.state;
      postalCode = postalCode || geoData.postalCode;
      country = country || geoData.country;
    }

    if (!address || !city || !state || !postalCode || !country) {
      return res.status(400).json({ success: false, msg: "Incomplete address details after geocoding" });
    }

    // Fetch existing address to check userId
    const existing = await db.select().from(UserAddressTable).where(eq(UserAddressTable.id, id));
    if (existing.length === 0) return res.status(404).json({ success: false, msg: "Address not found" });

    // If setting default, clear others for user
    if (isDefault) {
      await db
        .update(UserAddressTable)
        .set({ isDefault: false })
        .where(eq(UserAddressTable.userId, existing[0].userId));
    }

    const updated = await db
      .update(UserAddressTable)
      .set({
        name: name?.trim(),
        phone: phone?.trim(),
        altPhone: altPhone?.trim() || null,
        address: address?.trim(),
        city: city?.trim(),
        state: state?.trim(),
        postalCode: postalCode?.trim(),
        country: country?.trim(),
        landmark: landmark?.trim() || null,
        deliveryInstructions: deliveryInstructions?.trim() || null,
        addressType,
        label: label?.trim() || null,
        latitude: latitude?.toString() || null,
        longitude: longitude?.toString() || null,
        geoAccuracy: geoAccuracy?.toString() || null,
        isDefault,
        isVerified,
        isDeleted,
        updatedAt: new Date().toISOString()
      })
      .where(eq(UserAddressTable.id, id))
      .returning();

    // Invalidate user's address list cache
    await invalidateMultiple([{ key: makeUserAddressesKey(existing[0].userId) }]);

    return res.json({ success: true, msg: "Address updated successfully", data: updated[0] });
  } catch (err) {
    console.error("updateAddress error:", err);
    return res.status(500).json({ success: false, msg: "Server error" });
  }
}

// GET /api/address/list/:userId
export async function listAddresses(req, res) {
  try {
    const { userId } = req.params;
    if (!userId) return res.status(400).json({ success: false, msg: "Missing user ID" });

    const addresses = await db
      .select()
      .from(UserAddressTable)
      .where(and(
        eq(UserAddressTable.userId, userId),
        eq(UserAddressTable.isDeleted, false)
      ))
      .orderBy(desc(UserAddressTable.isDefault), desc(UserAddressTable.updatedAt));

    return res.json({ success: true, data: addresses });
  } catch (err) {
    console.error("listAddresses error:", err);
    return res.status(500).json({ success: false, msg: "Server error" });
  }
}

// DELETE /api/address/soft-delete/:id
export async function softDeleteAddress(req, res) {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ success: false, msg: "Missing address ID" });

    const existing = await db.select().from(UserAddressTable).where(eq(UserAddressTable.id, id));
    if (existing.length === 0) return res.status(404).json({ success: false, msg: "Address not found" });

    const userId = existing[0].userId;

    // Prevent deleting last address of user
    const total = await db.select().from(UserAddressTable).where(and(
      eq(UserAddressTable.userId, userId),
      eq(UserAddressTable.isDeleted, false)
    ));

    if (total.length <= 1) {
      return res.status(400).json({ success: false, msg: "Cannot delete last remaining address" });
    }

    await db
      .update(UserAddressTable)
      .set({ isDeleted: true, updatedAt: new Date().toISOString() })
      .where(eq(UserAddressTable.id, id));

    // If deleted was default → set latest as default
    if (existing[0].isDefault) {
      const latest = await db
        .select()
        .from(UserAddressTable)
        .where(and(eq(UserAddressTable.userId, userId), eq(UserAddressTable.isDeleted, false)))
        .orderBy(desc(UserAddressTable.updatedAt))
        .limit(1);

      if (latest.length > 0) {
        await db
          .update(UserAddressTable)
          .set({ isDefault: true, updatedAt: new Date().toISOString() })
          .where(eq(UserAddressTable.id, latest[0].id));
      }
    }
    
    // Invalidate user's address list cache
    await invalidateMultiple([{ key: makeUserAddressesKey(userId) }]);

    return res.json({ success: true, msg: "Address deleted successfully" });
  } catch (err) {
    console.error("softDeleteAddress error:", err);
    return res.status(500).json({ success: false, msg: "Server error" });
  }
}

// PUT /api/address/set-default/:id
export async function setDefaultAddress(req, res) {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ success: false, msg: "Missing address ID" });

    const existing = await db.select().from(UserAddressTable).where(eq(UserAddressTable.id, id));
    if (existing.length === 0) return res.status(404).json({ success: false, msg: "Address not found" });

    // Reset all to false first
    await db
      .update(UserAddressTable)
      .set({ isDefault: false })
      .where(eq(UserAddressTable.userId, existing[0].userId));

    // Set selected as default
    await db
      .update(UserAddressTable)
      .set({ isDefault: true, updatedAt: new Date().toISOString() })
      .where(eq(UserAddressTable.id, id));

    // Invalidate user's address list cache
    await invalidateMultiple([{ key: makeUserAddressesKey(existing[0].userId) }]);

    return res.json({ success: true, msg: "Default address updated" });
  } catch (err) {
    console.error("setDefaultAddress error:", err);
    return res.status(500).json({ success: false, msg: "Server error" });
  }
}

// POST /api/address/pincodes/batch
export async function createPincodesBatch(req, res) {
  try {
    const { pincodes } = req.body;
    if (!Array.isArray(pincodes) || pincodes.length === 0) {
      return res.status(400).json({ success: false, msg: "Pincode data is missing or invalid." });
    }

    // This command will INSERT new pincodes and UPDATE existing ones if they already exist.
    await db.insert(pincodeServiceabilityTable)
      .values(pincodes)
      .onConflictDoUpdate({
        target: pincodeServiceabilityTable.pincode,
        set: {
          city: sql`excluded.city`,
          state: sql`excluded.state`,
          isServiceable: sql`excluded.is_serviceable`,
          codAvailable: sql`excluded.cod_available`,
          deliveryCharge: sql`excluded.delivery_charge`,
        }
      });

    return res.status(201).json({ success: true, msg: `${pincodes.length} pincodes processed successfully.` });
  } catch (err) {
    console.error("createPincodesBatch error:", err);
    return res.status(500).json({ success: false, msg: "Server error during batch operation" });
  }
}

// GET /api/address/pincodes
export async function listPincodes(req, res) {
  try {
    const allPincodes = await db.select().from(pincodeServiceabilityTable).orderBy(pincodeServiceabilityTable.state, pincodeServiceabilityTable.city, pincodeServiceabilityTable.pincode);

    // Group the flat array into a nested object structure for the frontend
    const grouped = allPincodes.reduce((acc, pincode) => {
      const { state, city } = pincode;
      if (!acc[state]) {
        acc[state] = {};
      }
      if (!acc[state][city]) {
        acc[state][city] = [];
      }
      acc[state][city].push(pincode);
      return acc;
    }, {});

    return res.json({ success: true, data: grouped });
  } catch (err) {
    console.error("listPincodes error:", err);
    return res.status(500).json({ success: false, msg: "Server error" });
  }
}

// POST /api/address/pincodes
export async function createPincode(req, res) {
  try {
    const { pincode, isServiceable, codAvailable, onlinePaymentAvailable, deliveryCharge } = req.body;
    if (!pincode || !/^\d{6}$/.test(pincode)) {
      return res.status(400).json({ success: false, msg: "Invalid pincode" });
    }

    const inserted = await db
      .insert(pincodeServiceabilityTable)
      .values({ pincode, isServiceable, codAvailable, onlinePaymentAvailable, deliveryCharge })
      .returning();

    return res.status(201).json({ success: true, data: inserted[0] });
  } catch (err) {
    console.error("createPincode error:", err);
    return res.status(500).json({ success: false, msg: "Server error" });
  }
}

// PUT /api/address/pincodes/:pincode
export async function updatePincode(req, res) {
  try {
    const { pincode } = req.params;
    const { isServiceable, codAvailable, onlinePaymentAvailable, deliveryCharge } = req.body;

    const updated = await db
      .update(pincodeServiceabilityTable)
      .set({ isServiceable, codAvailable, onlinePaymentAvailable, deliveryCharge })
      .where(eq(pincodeServiceabilityTable.pincode, pincode))
      .returning();

    if (updated.length === 0) {
      return res.status(404).json({ success: false, msg: "Pincode not found" });
    }

    return res.json({ success: true, data: updated[0] });
  } catch (err) {
    console.error("updatePincode error:", err);
    return res.status(500).json({ success: false, msg: "Server error" });
  }
}

// DELETE /api/address/pincodes/:pincode
export async function deletePincode(req, res) {
  try {
    const { pincode } = req.params;
    await db.delete(pincodeServiceabilityTable).where(eq(pincodeServiceabilityTable.pincode, pincode));
    return res.json({ success: true, msg: "Pincode rule deleted" });
  } catch (err) {
    console.error("deletePincode error:", err);
    return res.status(500).json({ success: false, msg: "Server error" });
  }
}

// GET /api/address/pincode/:pincode
export async function checkPincodeServiceability(req, res) {
  try {
    const { pincode } = req.params;
    if (!pincode || !/^\d{6}$/.test(pincode)) {
      return res.status(400).json({ success: false, msg: "Invalid pincode" });
    }

    const serviceability = await db
      .select()
      .from(pincodeServiceabilityTable)
      .where(eq(pincodeServiceabilityTable.pincode, pincode));

    if (serviceability.length > 0) {
      return res.json({ success: true, data: serviceability[0] });
    } else {
      // Default response for pincodes not in the database
      return res.json({
        success: true,
        data: {
          pincode,
          isServiceable: false,
          codAvailable: false,
          onlinePaymentAvailable: true,
          deliveryCharge: 100, // Higher default charge for non-serviceable areas
        },
      });
    }
  } catch (err) {
    console.error("checkPincodeServiceability error:", err);
    return res.status(500).json({ success: false, msg: "Server error" });
  }
}

export async function getPincodeDetails(pincode) {
  // Return a default object for invalid or non-serviceable pincodes
  const defaults = {
    isServiceable: false,
    codAvailable: false,
    deliveryCharge: 100, // A default/higher charge
  };

  if (!pincode || !/^\d{6}$/.test(pincode)) {
    return defaults;
  }

  const [details] = await db
    .select()
    .from(pincodeServiceabilityTable)
    .where(eq(pincodeServiceabilityTable.pincode, pincode));

  // If found, return the details from DB; otherwise, return the defaults
  return details ? details : defaults;
}