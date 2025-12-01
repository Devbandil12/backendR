import { db } from '../configs/index.js';
import { UserAddressTable, pincodeServiceabilityTable } from '../configs/schema.js';
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import fetch from "node-fetch";
// Import helpers
import { invalidateMultiple } from "../invalidateHelpers.js";
import { makeUserAddressesKey } from "../cacheKeys.js";
import { createNotification } from '../helpers/notificationManager.js';

// 🟢 NEW: Helper to fetch from Google Places API
async function fetchGooglePlaces(query, key, pageToken = '') {
  const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&key=${key}${pageToken ? `&pagetoken=${pageToken}` : ''}`;
  const res = await fetch(url);
  return await res.json();
}

// 🟢 NEW: Controller to fetch pincodes via Google API (Smarter than India Post API)
export async function fetchGooglePincodes(req, res) {
  const { city } = req.params;
  const apiKey = process.env.GOOGLE_API_KEY;

  if (!city) return res.status(400).json({ success: false, msg: "City is required" });
  if (!apiKey) return res.status(500).json({ success: false, msg: "Google API Key is missing in server env" });

  try {
    const pincodesSet = new Set();
    const query = `Post offices in ${city}`;
    
    // Google Places API returns 20 results per page. We'll fetch up to 3 pages (60 results).
    let nextPageToken = null;
    let attempts = 0;

    do {
      const data = await fetchGooglePlaces(query, apiKey, nextPageToken);
      
      if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
        console.error("Google Places Error:", data.status);
        break;
      }

      // Extract pincodes from formatted_address (e.g., "Morar, Gwalior, MP 474006, India")
      data.results?.forEach(place => {
        const match = place.formatted_address.match(/\b\d{6}\b/);
        if (match) {
          pincodesSet.add(match[0]);
        }
      });

      nextPageToken = data.next_page_token;
      attempts++;

      // Google requires a short delay before the next_page_token becomes valid
      if (nextPageToken) await new Promise(r => setTimeout(r, 2000));

    } while (nextPageToken && attempts < 3);

    const sortedPincodes = Array.from(pincodesSet).sort();

    if (sortedPincodes.length === 0) {
      return res.json({ success: false, msg: "No pincodes found via Google Maps." });
    }

    return res.json({ success: true, data: sortedPincodes });

  } catch (error) {
    console.error("fetchGooglePincodes error:", error);
    return res.status(500).json({ success: false, msg: "Server error fetching from Google" });
  }
}

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

// POST /api/address/save
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

// PUT /api/address/set-default/:id
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

// POST /api/address/pincodes/batch
export async function createPincodesBatch(req, res) {
  try {
    const { pincodes } = req.body;
    if (!Array.isArray(pincodes) || pincodes.length === 0) {
      return res.status(400).json({ success: false, msg: "Pincode data is missing or invalid." });
    }

    // 🟢 FIX 1: Sanitize batch data (Trim spaces from City/State)
    const cleanPincodes = pincodes.map(p => ({
      ...p,
      city: p.city ? p.city.trim() : 'Unknown',
      state: p.state ? p.state.trim() : 'Unknown'
    }));

    const allPincodeStrings = cleanPincodes.map(p => p.pincode);

    const potentialUsers = await db.selectDistinct({ 
        userId: UserAddressTable.userId, 
        postalCode: UserAddressTable.postalCode 
      })
      .from(UserAddressTable)
      .where(inArray(UserAddressTable.postalCode, allPincodeStrings));

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
        if (rule.codAvailable) {
          notificationPromises.push(
            createNotification(user.userId, `Good news! Cash on Delivery is now available for your address in ${user.postalCode}.`, '/cart', 'system')
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

// GET /api/address/pincodes
export async function listPincodes(req, res) {
  try {
    const allPincodes = await db.select().from(pincodeServiceabilityTable).orderBy(pincodeServiceabilityTable.state, pincodeServiceabilityTable.city, pincodeServiceabilityTable.pincode);

    // 🟢 FIX 2: Robust Grouping Logic
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

// POST /api/address/pincodes
export async function createPincode(req, res) {
  try {
    let { pincode, city, state, isServiceable, codAvailable, onlinePaymentAvailable, deliveryCharge } = req.body;

    if (!pincode || !/^\d{6}$/.test(pincode)) {
      return res.status(400).json({ success: false, msg: "Invalid pincode" });
    }

    // 🟢 FIX 3: Sanitize Single Entry inputs
    city = city ? city.trim() : 'Unknown';
    state = state ? state.trim() : 'Unknown';

    const [newPincode] = await db
      .insert(pincodeServiceabilityTable)
      .values({
        pincode, city, state, isServiceable, codAvailable, onlinePaymentAvailable, deliveryCharge
      })
      .returning();

    if (newPincode.isServiceable) {
      const usersToNotify = await db.selectDistinct({ userId: UserAddressTable.userId })
        .from(UserAddressTable)
        .where(eq(UserAddressTable.postalCode, newPincode.pincode));

      if (usersToNotify.length > 0) {
        let message = newPincode.codAvailable 
          ? `Good news! We are now delivering to your area (${pincode}) and Cash on Delivery is available.`
          : `We've got you covered! We are now delivering to your area in ${newPincode.pincode}.`;
        
        let link = newPincode.codAvailable ? '/cart' : '/';

        const promises = usersToNotify.map(user => createNotification(user.userId, message, link, 'system'));
        Promise.allSettled(promises);
      }
    }

    return res.status(201).json({ success: true, data: newPincode });

  } catch (err) {
    console.error("[DEBUG] createPincode FAILED:", err);
    if (err.code === '23505') {
      return res.status(409).json({ success: false, msg: "Pincode already exists." });
    }
    return res.status(500).json({ success: false, msg: "Server error" });
  }
}

// PUT /api/address/pincodes/:pincode
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


// 🟢 NEW: Helper to fetch City Suggestions from Google Autocomplete
export async function searchGoogleCities(req, res) {
  const { query } = req.params;
  const apiKey = process.env.GOOGLE_API_KEY;

  if (!query) return res.status(400).json({ success: false, msg: "Query is required" });
  if (!apiKey) return res.status(500).json({ success: false, msg: "Google API Key missing" });

  try {
    // Restrict results to (regions) to find cities/towns/localities
    const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(query)}&types=(regions)&components=country:in&key=${apiKey}`;
    
    const response = await fetch(url);
    const data = await response.json();

    if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
      console.error("Google Autocomplete Error:", data.status);
      return res.json({ success: false, msg: "Google API Error" });
    }

    // Extract just the main name (e.g., "Gwalior", "Morar", "Lashkar")
    const cities = data.predictions.map(p => p.structured_formatting.main_text);
    
    // Remove duplicates
    const uniqueCities = [...new Set(cities)];

    return res.json({ success: true, data: uniqueCities });

  } catch (error) {
    console.error("searchGoogleCities error:", error);
    return res.status(500).json({ success: false, msg: "Server error" });
  }
}