import * as AddressesService from './addresses.service.js';
import * as AddressesRepository from './addresses.repository.js';
import { invalidateMultiple } from "../../infrastructure/cache/cache.invalidate.js";
import { makeUserAddressesKey } from "../../infrastructure/cache/cache.keys.js";

export async function searchCitiesByState(req, res) {
  const { query, state } = req.params;

  if (!query) return res.json({ success: true, data: [] });
  if (!state) return res.status(400).json({ success: false, msg: "State is required for search context" });

  try {
    const cities = await AddressesService.fetchGoogleAutocomplete(`${query} ${state}`);
    const filteredCities = cities.filter(c => c !== state && c !== 'India');

    return res.json({ success: true, data: filteredCities });
  } catch (error) {
    console.error("searchCitiesByState error:", error);
    return res.status(500).json({ success: false, msg: "Server error fetching cities" });
  }
}

export async function listPincodesByStateAndCityDB(req, res) {
  try {
    const { state, city } = req.params;
    if (!state || !city) return res.status(400).json({ success: false, msg: "State and City are required." });

    const pincodes = await AddressesRepository.getPincodesByCityAndState(state, city);
    return res.json({ success: true, data: pincodes });
  } catch (err) {
    console.error("listPincodesByStateAndCityDB error:", err);
    return res.status(500).json({ success: false, msg: "Server error" });
  }
}

export async function reverseGeocodeController(req, res) {
  const { lat, lon } = req.query;

  if (!lat || !lon) {
    return res.status(400).json({ success: false, msg: "Latitude and longitude are required." });
  }

  try {
    const geoData = await AddressesService.reverseGeocode(lat, lon);
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
      isDefault = false, isDeleted = false
    } = req.body;

    if (!userId || !name || !phone) {
      return res.status(400).json({ success: false, msg: "Missing required fields: userId, name, or phone" });
    }

    try {
      AddressesService.validatePhones(phone, altPhone);
    } catch (e) {
      return res.status(400).json({ success: false, msg: e.message });
    }

    if ((!address || !city || !state || !postalCode || !country) && latitude && longitude) {
      const geoData = await AddressesService.reverseGeocode(latitude, longitude);
      address = address || geoData.address;
      city = city || geoData.city;
      state = state || geoData.state;
      postalCode = postalCode || geoData.postalCode;
      country = country || geoData.country;
    }

    if (!address || !city || !state || !postalCode || !country) {
      return res.status(400).json({ success: false, msg: "Incomplete address details after geocoding" });
    }

    try {
      await AddressesService.checkSingularityForHomeWork(userId, addressType);
    } catch (e) {
      return res.status(409).json({ success: false, msg: e.message });
    }

    const inserted = await AddressesService.createAddress({
      userId, name: name.trim(), phone: phone.trim(), altPhone: altPhone?.trim() || null,
      address: address.trim(), city: city.trim(), state: state.trim(), postalCode: postalCode.trim(), country: country.trim(),
      landmark: landmark?.trim() || null, deliveryInstructions: deliveryInstructions?.trim() || null, addressType, label: label?.trim() || null,
      latitude: latitude?.toString() || null, longitude: longitude?.toString() || null, geoAccuracy: geoAccuracy?.toString() || null,
      isDefault, isDeleted
    });

    await invalidateMultiple([{ key: makeUserAddressesKey(userId) }]);
    return res.json({ success: true, msg: "Address saved successfully", data: inserted });
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
      isDefault, isDeleted
    } = req.body;

    try {
      AddressesService.validatePhones(phone, altPhone);
    } catch (e) {
      return res.status(400).json({ success: false, msg: e.message });
    }

    if ((!address || !city || !state || !postalCode || !country) && latitude && longitude) {
      const geoData = await AddressesService.reverseGeocode(latitude, longitude);
      address = address || geoData.address;
      city = city || geoData.city;
      state = state || geoData.state;
      postalCode = postalCode || geoData.postalCode;
      country = country || geoData.country;
    }

    if (!address || !city || !state || !postalCode || !country) {
      return res.status(400).json({ success: false, msg: "Incomplete address details after geocoding" });
    }

    const existing = await AddressesRepository.getAddressById(id);
    if (!existing) return res.status(404).json({ success: false, msg: "Address not found" });

    try {
      const updated = await AddressesService.updateAddress(id, {
        name: name?.trim(), phone: phone?.trim(), altPhone: altPhone?.trim() || null,
        address: address?.trim(), city: city?.trim(), state: state?.trim(), postalCode: postalCode?.trim(), country: country?.trim(),
        landmark: landmark?.trim() || null, deliveryInstructions: deliveryInstructions?.trim() || null, addressType, label: label?.trim() || null,
        latitude: latitude?.toString() || null, longitude: longitude?.toString() || null, geoAccuracy: geoAccuracy?.toString() || null,
        isDefault, isDeleted
      }, existing);

      await invalidateMultiple([{ key: makeUserAddressesKey(existing.userId) }]);
      return res.json({ success: true, msg: "Address updated successfully", data: updated });
    } catch (e) {
      if (e.message.includes("already have a")) return res.status(409).json({ success: false, msg: e.message });
      throw e;
    }

  } catch (err) {
    console.error("updateAddress error:", err);
    return res.status(500).json({ success: false, msg: "Server error" });
  }
}

export async function listAddresses(req, res) {
  try {
    const { userId } = req.params;
    if (!userId) return res.status(400).json({ success: false, msg: "Missing user ID" });

    const addresses = await AddressesRepository.getActiveAddressesByUser(userId);
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

    const existing = await AddressesRepository.getAddressById(id);
    if (!existing) return res.status(404).json({ success: false, msg: "Address not found" });

    try {
      await AddressesService.softDeleteAddress(id, existing.userId);
      await invalidateMultiple([{ key: makeUserAddressesKey(existing.userId) }]);
      return res.json({ success: true, msg: "Address deleted successfully" });
    } catch (e) {
      return res.status(400).json({ success: false, msg: e.message });
    }

  } catch (err) {
    console.error("softDeleteAddress error:", err);
    return res.status(500).json({ success: false, msg: "Server error" });
  }
}

export async function setDefaultAddress(req, res) {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ success: false, msg: "Missing address ID" });

    const existing = await AddressesRepository.getAddressById(id);
    if (!existing) return res.status(404).json({ success: false, msg: "Address not found" });

    await AddressesService.setDefaultAddress(id, existing.userId);
    await invalidateMultiple([{ key: makeUserAddressesKey(existing.userId) }]);

    return res.json({ success: true, msg: "Default address updated" });
  } catch (err) {
    console.error("setDefaultAddress error:", err);
    return res.status(500).json({ success: false, msg: "Server error" });
  }
}

export async function createPincodesBatch(req, res) {
  try {
    const { pincodes } = req.body;
    if (!Array.isArray(pincodes) || pincodes.length === 0) {
      return res.status(400).json({ success: false, msg: "Pincode data is missing or invalid." });
    }

    const count = await AddressesService.processPincodesBatch(pincodes);

    if (count === 0) {
      return res.json({ success: true, msg: "No valid unique pincodes found in this batch." });
    }
    
    return res.status(201).json({ success: true, msg: `${count} pincodes processed successfully.` });
  } catch (err) {
    console.error("createPincodesBatch error:", err);
    return res.status(500).json({ success: false, msg: "Server error during batch operation" });
  }
}

export async function listPincodes(req, res) {
  try {
    const allPincodes = await AddressesRepository.getAllPincodes();

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

    try {
      const updatedPincode = await AddressesService.updatePincode(pincode, { isServiceable, codAvailable, onlinePaymentAvailable, deliveryCharge });
      return res.json({ success: true, data: updatedPincode });
    } catch (e) {
      return res.status(404).json({ success: false, msg: e.message });
    }

  } catch (err) {
    console.error("updatePincode error:", err);
    return res.status(500).json({ success: false, msg: "Server error" });
  }
}

export async function deletePincode(req, res) {
  try {
    const { pincode } = req.params;
    await AddressesRepository.deletePincode(pincode);
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

    const details = await AddressesRepository.getPincodeDetails(pincode);
    if (details) {
      return res.json({ success: true, data: details });
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

export async function bulkUpdatePincodes(req, res) {
  try {
    const { pincodes, updates } = req.body; 
    
    if (!Array.isArray(pincodes) || pincodes.length === 0) {
      return res.status(400).json({ success: false, msg: "No pincodes selected" });
    }

    const validUpdates = {};
    if (updates.deliveryCharge !== undefined && updates.deliveryCharge !== "") validUpdates.deliveryCharge = parseInt(updates.deliveryCharge);
    if (updates.isServiceable !== undefined) validUpdates.isServiceable = updates.isServiceable;
    if (updates.codAvailable !== undefined) validUpdates.codAvailable = updates.codAvailable;

    if (Object.keys(validUpdates).length === 0) {
      return res.status(400).json({ success: false, msg: "No valid updates provided" });
    }

    await AddressesRepository.bulkUpdatePincodesList(pincodes, validUpdates);

    return res.json({ success: true, msg: `Updated ${pincodes.length} pincodes successfully` });
  } catch (err) {
    console.error("bulkUpdatePincodes error:", err);
    return res.status(500).json({ success: false, msg: "Server error" });
  }
}

export async function bulkDeletePincodes(req, res) {
  try {
    const { pincodes } = req.body;
    
    if (!Array.isArray(pincodes) || pincodes.length === 0) {
      return res.status(400).json({ success: false, msg: "No pincodes selected" });
    }

    await AddressesRepository.bulkDeletePincodesList(pincodes);

    return res.json({ success: true, msg: `Deleted ${pincodes.length} pincodes successfully` });
  } catch (err) {
    console.error("bulkDeletePincodes error:", err);
    return res.status(500).json({ success: false, msg: "Server error" });
  }
}

export async function bulkUpdateRegion(req, res) {
  try {
    const { state, city, updates, isGlobal } = req.body; 
    
    if (!isGlobal && !state) {
      return res.status(400).json({ success: false, msg: "State is required for regional updates" });
    }

    const validUpdates = {};
    if (updates.deliveryCharge !== undefined && updates.deliveryCharge !== "") 
        validUpdates.deliveryCharge = parseInt(updates.deliveryCharge);
    if (updates.isServiceable !== undefined) validUpdates.isServiceable = updates.isServiceable;
    if (updates.codAvailable !== undefined) validUpdates.codAvailable = updates.codAvailable;

    if (Object.keys(validUpdates).length === 0) {
      return res.status(400).json({ success: false, msg: "No valid updates provided" });
    }

    const count = await AddressesService.updateBulkRegion(state, city, isGlobal, validUpdates);
    const targetName = isGlobal ? "Entire Database" : (city ? `${city}, ${state}` : state);

    return res.json({ 
        success: true, 
        msg: `Updated ${count} pincodes in ${targetName}` 
    });
  } catch (err) {
    console.error("bulkUpdateRegion error:", err);
    return res.status(500).json({ success: false, msg: "Server error" });
  }
}

export async function bulkDeleteRegion(req, res) {
  try {
    const { state, city, isGlobal } = req.body;

    if (!isGlobal && !state) {
      return res.status(400).json({ success: false, msg: "State is required" });
    }

    const count = await AddressesService.deleteBulkRegion(state, city, isGlobal);
    const targetName = isGlobal ? "Entire Database" : (city ? `${city}, ${state}` : state);

    return res.json({ 
        success: true, 
        msg: `Deleted ${count} pincodes from ${targetName}` 
    });

  } catch (err) {
    console.error("bulkDeleteRegion error:", err);
    return res.status(500).json({ success: false, msg: "Server error" });
  }
}
