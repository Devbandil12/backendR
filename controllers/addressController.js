import { db } from '../configs/index.js';
import { UserAddressTable, pincodeServiceabilityTable } from '../configs/schema.js';
import { eq, and, desc, sql, inArray } from "drizzle-orm"; 
import fetch from "node-fetch";

// Import helpers
import { invalidateMultiple } from "../invalidateHelpers.js";
import { makeUserAddressesKey } from "../cacheKeys.js";
import { createNotification } from '../helpers/notificationManager.js';

const API_KEY = process.env.GOOGLE_API_KEY;

// 🟢 Helper to fetch City Suggestions from Google Autocomplete
async function fetchGoogleAutocomplete(query, countryCode = 'in') {
  if (!API_KEY) throw new Error("Google API Key is missing in server env");
  const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(query)}&types=(regions)&components=country:${countryCode}&key=${API_KEY}`;
  const response = await fetch(url);
  const data = await response.json();
  
  if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
    console.error("Google Autocomplete Error:", data.status);
    throw new Error("Google API Error: " + data.status);
  }
  
  // Extract just the main name (City/District)
  const cities = data.predictions.map(p => p.structured_formatting.main_text);
  return [...new Set(cities)];
}

// 🟢 CONTROLLER FOR TAB 1 (City Search)
export async function searchCitiesByState(req, res) {
  const { query, state } = req.params;

  if (!query) return res.json({ success: true, data: [] });
  if (!state) return res.status(400).json({ success: false, msg: "State is required for search context" });

  try {
    const cities = await fetchGoogleAutocomplete(`${query} ${state}`);
    const filteredCities = cities.filter(c => c !== state && c !== 'India');

    return res.json({ success: true, data: filteredCities });

  } catch (error) {
    console.error("searchCitiesByState error:", error);
    return res.status(500).json({ success: false, msg: "Server error fetching cities" });
  }
}

// 🟢 CONTROLLER FOR TAB 2 (Get All Pincodes in DB for a City)
export async function listPincodesByStateAndCityDB(req, res) {
  try {
    const { state, city } = req.params;
    if (!state || !city) return res.status(400).json({ success: false, msg: "State and City are required." });

    const pincodes = await db
      .select()
      .from(pincodeServiceabilityTable)
      .where(and(
          eq(pincodeServiceabilityTable.state, state.trim()),
          eq(pincodeServiceabilityTable.city, city.trim())
      ))
      .orderBy(pincodeServiceabilityTable.pincode);

    return res.json({ success: true, data: pincodes });

  } catch (err) {
    console.error("listPincodesByStateAndCityDB error:", err);
    return res.status(500).json({ success: false, msg: "Server error" });
  }
}

// Reverse Geocode helper (Kept for address management)
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

export async function reverseGeocodeController(req, res) {
  const { lat, lon } = req.query;

  if (!lat || !lon) {
    return res.status(400).json({ success: false, msg: "Latitude and longitude are required." });
  }

  try {
    const geoData = await reverseGeocode(lat, lon);
    return res.json(geoData);
  } catch (error) {
    console.error("Reverse geocode controller error:", error);
    return res.status(500).json({ success: false, msg: "Server error during reverse geocoding." });
  }
}

export async function saveAddress(req, res) {
  try {
    let {
      userId, name, phone, altPhone, address, city, state, postalCode, country,
      landmark, deliveryInstructions, addressType = "Home", label,
      latitude, longitude, geoAccuracy,
      isDefault = false, isVerified = false, isDeleted = false
    } = req.body;

    if (!userId || !name || !phone) {
      return res.status(400).json({ success: false, msg: "Missing required fields: userId, name, or phone" });
    }

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
      })
      .returning();

    await invalidateMultiple([{ key: makeUserAddressesKey(userId) }]);

    return res.json({ success: true, msg: "Address saved successfully", data: inserted[0] });
  } catch (err) {
    console.error("saveAddress error:", err);
    return res.status(500).json({ success: false, msg: "Server error" });
  }
}

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

    const existing = await db.select().from(UserAddressTable).where(eq(UserAddressTable.id, id));
    if (existing.length === 0) return res.status(404).json({ success: false, msg: "Address not found" });

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
        updatedAt: new Date()
      })
      .where(eq(UserAddressTable.id, id))
      .returning();

    await invalidateMultiple([{ key: makeUserAddressesKey(existing[0].userId) }]);

    return res.json({ success: true, msg: "Address updated successfully", data: updated[0] });
  } catch (err) {
    console.error("updateAddress error:", err);
    return res.status(500).json({ success: false, msg: "Server error" });
  }
}

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

export async function softDeleteAddress(req, res) {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ success: false, msg: "Missing address ID" });

    const existing = await db.select().from(UserAddressTable).where(eq(UserAddressTable.id, id));
    if (existing.length === 0) return res.status(404).json({ success: false, msg: "Address not found" });

    const userId = existing[0].userId;

    const total = await db.select().from(UserAddressTable).where(and(
      eq(UserAddressTable.userId, userId),
      eq(UserAddressTable.isDeleted, false)
    ));

    if (total.length <= 1) {
      return res.status(400).json({ success: false, msg: "Cannot delete last remaining address" });
    }

    await db
      .update(UserAddressTable)
      .set({ isDeleted: true, updatedAt: new Date() })
      .where(eq(UserAddressTable.id, id));

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
          .set({ isDefault: true, updatedAt: new Date() })
          .where(eq(UserAddressTable.id, latest[0].id));
      }
    }

    await invalidateMultiple([{ key: makeUserAddressesKey(userId) }]);

    return res.json({ success: true, msg: "Address deleted successfully" });
  } catch (err) {
    console.error("softDeleteAddress error:", err);
    return res.status(500).json({ success: false, msg: "Server error" });
  }
}

export async function setDefaultAddress(req, res) {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ success: false, msg: "Missing address ID" });

    const existing = await db.select().from(UserAddressTable).where(eq(UserAddressTable.id, id));
    if (existing.length === 0) return res.status(404).json({ success: false, msg: "Address not found" });

    await db
      .update(UserAddressTable)
      .set({ isDefault: false })
      .where(eq(UserAddressTable.userId, existing[0].userId));

    await db
      .update(UserAddressTable)
      .set({ isDefault: true, updatedAt: new Date() })
      .where(eq(UserAddressTable.id, id));

    await invalidateMultiple([{ key: makeUserAddressesKey(existing[0].userId) }]);

    return res.json({ success: true, msg: "Default address updated" });
  } catch (err) {
    console.error("setDefaultAddress error:", err);
    return res.status(500).json({ success: false, msg: "Server error" });
  }
}

// POST /api/address/pincodes/batch (Used by Tab 1 Import)
export async function createPincodesBatch(req, res) {
  try {
    const { pincodes } = req.body;
    if (!Array.isArray(pincodes) || pincodes.length === 0) {
      return res.status(400).json({ success: false, msg: "Pincode data is missing or invalid." });
    }

    // 1. Deduplicate: Use a Map to ensure each pincode appears only once per batch
    const uniquePincodesMap = new Map();
    pincodes.forEach(p => {
        if (p.pincode) {
            // This overwrites duplicates, keeping the last "District/State" found for this pincode
            uniquePincodesMap.set(p.pincode.toString(), {
                ...p,
                city: p.city ? p.city.trim() : 'Unknown',
                state: p.state ? p.state.trim() : 'Unknown'
            });
        }
    });

    const cleanPincodes = Array.from(uniquePincodesMap.values());

    if (cleanPincodes.length === 0) {
        return res.json({ success: true, msg: "No valid unique pincodes found in this batch." });
    }

    // 2. Find existing users to notify (Optional Logic)
    const allPincodeStrings = cleanPincodes.map(p => p.pincode);
    const potentialUsers = await db.selectDistinct({ 
        userId: UserAddressTable.userId, 
        postalCode: UserAddressTable.postalCode 
      })
      .from(UserAddressTable)
      .where(inArray(UserAddressTable.postalCode, allPincodeStrings));

    // 3. Upsert (Insert or Update if exists)
    await db.insert(pincodeServiceabilityTable)
      .values(cleanPincodes)
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
    
    // 4. Send Notifications (Fire and Forget)
    if (potentialUsers.length > 0) {
      let notificationPromises = [];
      const pincodeRules = new Map(cleanPincodes.map(p => [p.pincode, p]));

      for (const user of potentialUsers) {
        const rule = pincodeRules.get(user.postalCode);
        if (!rule) continue;

        if (rule.isServiceable) {
          notificationPromises.push(
            createNotification(user.userId, `We've got you covered! We are now delivering to your area in ${user.postalCode}.`, '/', 'system')
          );
        }
      }
      Promise.allSettled(notificationPromises);
    }
    
    return res.status(201).json({ success: true, msg: `${cleanPincodes.length} pincodes processed successfully.` });
  
  } catch (err) {
    console.error("createPincodesBatch error:", err);
    return res.status(500).json({ success: false, msg: "Server error during batch operation" });
  }
}

// GET /api/address/pincodes (Used by Tab 2 Master List)
export async function listPincodes(req, res) {
  try {
    const allPincodes = await db.select().from(pincodeServiceabilityTable).orderBy(pincodeServiceabilityTable.state, pincodeServiceabilityTable.city, pincodeServiceabilityTable.pincode);

    const grouped = allPincodes.reduce((acc, pincode) => {
      const state = pincode.state ? pincode.state.trim() : "Unknown";
      const city = pincode.city ? pincode.city.trim() : "Unknown";

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

export async function updatePincode(req, res) {
  try {
    const { pincode } = req.params;
    const { isServiceable, codAvailable, onlinePaymentAvailable, deliveryCharge } = req.body;

    const [oldPincode] = await db
      .select({
        codAvailable: pincodeServiceabilityTable.codAvailable,
        isServiceable: pincodeServiceabilityTable.isServiceable
      })
      .from(pincodeServiceabilityTable)
      .where(eq(pincodeServiceabilityTable.pincode, pincode));

    const [updatedPincode] = await db
      .update(pincodeServiceabilityTable)
      .set({ isServiceable, codAvailable, onlinePaymentAvailable, deliveryCharge })
      .where(eq(pincodeServiceabilityTable.pincode, pincode))
      .returning();

    if (!updatedPincode) {
      return res.status(404).json({ success: false, msg: "Pincode not found" });
    }

    // --- Notification Logic ---
    const codJustEnabled = codAvailable === true && oldPincode?.codAvailable === false;
    const serviceJustEnabled = isServiceable === true && oldPincode?.isServiceable === false;

    if (codJustEnabled || serviceJustEnabled) {
      const usersToNotify = await db.selectDistinct({ userId: UserAddressTable.userId })
        .from(UserAddressTable)
        .where(eq(UserAddressTable.postalCode, pincode));

      if (usersToNotify.length > 0) {
        let notificationsToSend = [];
        if (serviceJustEnabled) {
          notificationsToSend.push({ message: `We've got you covered! We are now delivering to your area in ${pincode}.`, link: '/' });
        }
        if (codJustEnabled) {
          notificationsToSend.push({ message: `Good news! Cash on Delivery is now available for your address in ${pincode}.`, link: '/cart' });
        }

        let promises = [];
        for (const user of usersToNotify) {
          for (const notif of notificationsToSend) {
            promises.push(createNotification(user.userId, notif.message, notif.link, 'system'));
          }
        }
        Promise.allSettled(promises);
      }
    }

    return res.json({ success: true, data: updatedPincode });

  } catch (err) {
    console.error("updatePincode error:", err);
    return res.status(500).json({ success: false, msg: "Server error" });
  }
}

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
      return res.json({
        success: true,
        data: {
          pincode,
          isServiceable: false,
          codAvailable: false,
          onlinePaymentAvailable: true,
          deliveryCharge: 100,
        },
      });
    }
  } catch (err) {
    console.error("checkPincodeServiceability error:", err);
    return res.status(500).json({ success: false, msg: "Server error" });
  }
}

export async function getPincodeDetails(pincode) {
  const defaults = { isServiceable: false, codAvailable: false, deliveryCharge: 100 };
  if (!pincode || !/^\d{6}$/.test(pincode)) return defaults;

  const [details] = await db
    .select()
    .from(pincodeServiceabilityTable)
    .where(eq(pincodeServiceabilityTable.pincode, pincode));

  return details ? details : defaults;
}