// src/controllers/addressController.js
import { db } from '../configs/index.js';
import { UserAddressTable } from '../configs/schema.js';
import { eq, and, desc } from "drizzle-orm";
import fetch from "node-fetch";

// Reverse Geocode helper to fill missing address details from lat/lng
async function reverseGeocode(lat, lng) {
  if (!lat || !lng) return {};
  const res = await fetch(
    `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${process.env.GOOGLE_API_KEY}`
  );
  const data = await res.json();
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

    return res.json({ success: true, msg: "Default address updated" });
  } catch (err) {
    console.error("setDefaultAddress error:", err);
    return res.status(500).json({ success: false, msg: "Server error" });
  }
}