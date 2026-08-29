import fetch from "node-fetch";
import * as AddressesRepository from './addresses.repository.js';
import { createNotification } from '../../modules/notifications/notifications.service.js';
import { db } from '../../db/client.js';
import { pincodeServiceabilityTable } from '../../db/schema/index.js';
import { eq, and } from "drizzle-orm";

const API_KEY = process.env.GOOGLE_API_KEY;

function toE164India(phone) {
  const digitsOnly = String(phone || '').replace(/\D/g, '');
  if (digitsOnly.length === 10) return `91${digitsOnly}`;
  if (digitsOnly.length === 12 && digitsOnly.startsWith('91')) return digitsOnly;
  return null;
}

export async function isPhoneVerifiedForUser(userId, phone) {
  const normalized = toE164India(phone);
  if (!normalized) return false;
  return await AddressesRepository.getVerifiedPhone(userId, normalized) !== null;
}

export async function fetchGoogleAutocomplete(query, countryCode = 'in') {
  if (!API_KEY) throw new Error("Google API Key is missing in server env");
  const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(query)}&types=(regions)&components=country:${countryCode}&key=${API_KEY}`;
  const response = await fetch(url);
  const data = await response.json();
  
  if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
    console.error("Google Autocomplete Error:", data.status);
    throw new Error("Google API Error: " + data.status);
  }
  
  const cities = data.predictions.map(p => p.structured_formatting.main_text);
  return [...new Set(cities)];
}

export async function reverseGeocode(lat, lng) {
  if (!lat || !lng) return {};
  const res = await fetch(
    `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${API_KEY}`
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

export const validatePhones = (phone, altPhone) => {
  const phoneRegex = /^[6-9]\d{9}$/;
  if (phone !== undefined && !phoneRegex.test(phone.trim())) {
    throw new Error("A valid 10-digit mobile number is required.");
  }
  if (altPhone !== undefined && altPhone && altPhone.trim() !== "" && !phoneRegex.test(altPhone.trim())) {
    throw new Error("A valid 10-digit alternate mobile number is required.");
  }
};

export const checkSingularityForHomeWork = async (userId, addressType, excludeId = null) => {
  if (['Home', 'Work'].includes(addressType)) {
    const existingOfType = await AddressesRepository.getExistingAddressByType(userId, addressType, excludeId);
    if (existingOfType) {
      throw new Error(`You already have a ${addressType} address saved. Edit that one, or save this as "Other" instead.`);
    }
  }
};

export const createAddress = async (data) => {
  if (data.isDefault) {
    await AddressesRepository.removeDefaultAddressFlag(data.userId);
  }

  data.isVerified = await isPhoneVerifiedForUser(data.userId, data.phone);
  
  if (!data.isVerified) {
    const error = new Error('Please verify your phone number.');
    error.code = 'PHONE_VERIFICATION_REQUIRED';
    error.purpose = 'ADDRESS';
    throw error;
  }

  return await AddressesRepository.insertAddress(data);
};

export const updateAddress = async (id, data, existing) => {
  const targetType = data.addressType !== undefined ? data.addressType : existing.addressType;
  
  if (['Home', 'Work'].includes(targetType) && targetType !== existing.addressType) {
    await checkSingularityForHomeWork(existing.userId, targetType, id);
  }

  if (data.isDefault) {
    await AddressesRepository.removeDefaultAddressFlag(existing.userId);
  }

  const phoneToCheck = data.phone !== undefined ? data.phone : existing.phone;
  data.isVerified = await isPhoneVerifiedForUser(existing.userId, phoneToCheck);

  if (!data.isVerified) {
    const error = new Error('Please verify your phone number.');
    error.code = 'PHONE_VERIFICATION_REQUIRED';
    error.purpose = 'ADDRESS';
    throw error;
  }

  return await AddressesRepository.updateAddress(id, data);
};

export const softDeleteAddress = async (id, userId) => {
  const activeAddresses = await AddressesRepository.getActiveAddressesByUser(userId);

  if (activeAddresses.length <= 1) {
    throw new Error("Cannot delete last remaining address");
  }

  await AddressesRepository.updateAddress(id, { isDeleted: true });

  const existing = activeAddresses.find(a => a.id === id);

  if (existing?.isDefault) {
    const latest = await AddressesRepository.getLatestActiveAddress(userId);
    if (latest) {
      await AddressesRepository.updateAddress(latest.id, { isDefault: true });
    }
  }
};

export const setDefaultAddress = async (id, userId) => {
  await AddressesRepository.removeDefaultAddressFlag(userId);
  await AddressesRepository.updateAddress(id, { isDefault: true });
};

export const processPincodesBatch = async (pincodes) => {
  const uniquePincodesMap = new Map();
  pincodes.forEach(p => {
      if (p.pincode) {
          uniquePincodesMap.set(p.pincode.toString(), {
              ...p,
              city: p.city ? p.city.trim() : 'Unknown',
              state: p.state ? p.state.trim() : 'Unknown'
          });
      }
  });

  const cleanPincodes = Array.from(uniquePincodesMap.values());

  if (cleanPincodes.length === 0) return 0;

  const allPincodeStrings = cleanPincodes.map(p => p.pincode);
  const potentialUsers = await AddressesRepository.getUsersWithPincodes(allPincodeStrings);

  await AddressesRepository.upsertPincodesBatch(cleanPincodes);
  
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

  return cleanPincodes.length;
};

export const updatePincode = async (pincode, data) => {
  const oldPincode = await AddressesRepository.getPincodeDetails(pincode);
  const updatedPincode = await AddressesRepository.updatePincode(pincode, data);

  if (!updatedPincode) throw new Error("Pincode not found");

  const codJustEnabled = data.codAvailable === true && oldPincode?.codAvailable === false;
  const serviceJustEnabled = data.isServiceable === true && oldPincode?.isServiceable === false;

  if (codJustEnabled || serviceJustEnabled) {
    const usersToNotify = await AddressesRepository.getUsersWithPincodes([pincode]);

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

  return updatedPincode;
};

export const updateBulkRegion = async (state, city, isGlobal, validUpdates) => {
  let query = db.update(pincodeServiceabilityTable).set(validUpdates);

  if (!isGlobal) {
      const whereClause = city 
          ? and(
              eq(pincodeServiceabilityTable.state, state),
              eq(pincodeServiceabilityTable.city, city)
            )
          : eq(pincodeServiceabilityTable.state, state);
      
      query = query.where(whereClause);
  }

  const result = await AddressesRepository.executePincodeQuery(query);
  return result.length;
};

export const deleteBulkRegion = async (state, city, isGlobal) => {
  let query = db.delete(pincodeServiceabilityTable);

  if (!isGlobal) {
      const whereClause = city 
          ? and(
              eq(pincodeServiceabilityTable.state, state),
              eq(pincodeServiceabilityTable.city, city)
            )
          : eq(pincodeServiceabilityTable.state, state);
      query = query.where(whereClause);
  }

  const result = await AddressesRepository.executePincodeQuery(query);
  return result.length;
};
