import { db } from '../../db/client.js';
import { UserAddressTable, pincodeServiceabilityTable, verifiedPhonesTable } from '../../db/schema/index.js';
import { eq, and, desc, sql, inArray, ne } from "drizzle-orm";

export const getVerifiedPhone = async (userId, phone) => {
  if (!userId || !phone) return null;
  const [row] = await db.select({ id: verifiedPhonesTable.id })
    .from(verifiedPhonesTable)
    .where(and(eq(verifiedPhonesTable.userId, userId), eq(verifiedPhonesTable.phone, phone.trim())))
    .limit(1);
  return row;
};

export const getPincodesByCityAndState = async (state, city) => {
  return await db
    .select()
    .from(pincodeServiceabilityTable)
    .where(and(
        eq(pincodeServiceabilityTable.state, state.trim()),
        eq(pincodeServiceabilityTable.city, city.trim())
    ))
    .orderBy(pincodeServiceabilityTable.pincode);
};

export const getExistingAddressByType = async (userId, addressType, excludeId = null) => {
  let query = db.select({ id: UserAddressTable.id })
    .from(UserAddressTable)
    .where(and(
      eq(UserAddressTable.userId, userId),
      eq(UserAddressTable.addressType, addressType),
      eq(UserAddressTable.isDeleted, false)
    ));

  if (excludeId) {
    query = query.where(and(
      eq(UserAddressTable.userId, userId),
      eq(UserAddressTable.addressType, addressType),
      eq(UserAddressTable.isDeleted, false),
      ne(UserAddressTable.id, excludeId)
    ));
  }

  const [existing] = await query.limit(1);
  return existing;
};

export const removeDefaultAddressFlag = async (userId) => {
  await db
    .update(UserAddressTable)
    .set({ isDefault: false })
    .where(eq(UserAddressTable.userId, userId));
};

export const insertAddress = async (data) => {
  const [inserted] = await db
    .insert(UserAddressTable)
    .values(data)
    .returning();
  return inserted;
};

export const getAddressById = async (id) => {
  const [address] = await db.select().from(UserAddressTable).where(eq(UserAddressTable.id, id));
  return address;
};

export const updateAddress = async (id, data) => {
  const [updated] = await db
    .update(UserAddressTable)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(UserAddressTable.id, id))
    .returning();
  return updated;
};

export const getActiveAddressesByUser = async (userId) => {
  return await db
    .select()
    .from(UserAddressTable)
    .where(and(
      eq(UserAddressTable.userId, userId),
      eq(UserAddressTable.isDeleted, false)
    ))
    .orderBy(desc(UserAddressTable.isDefault), desc(UserAddressTable.updatedAt));
};

export const getLatestActiveAddress = async (userId) => {
  const [latest] = await db
    .select()
    .from(UserAddressTable)
    .where(and(eq(UserAddressTable.userId, userId), eq(UserAddressTable.isDeleted, false)))
    .orderBy(desc(UserAddressTable.updatedAt))
    .limit(1);
  return latest;
};

export const getUsersWithPincodes = async (pincodesList) => {
  return await db.selectDistinct({ 
      userId: UserAddressTable.userId, 
      postalCode: UserAddressTable.postalCode 
    })
    .from(UserAddressTable)
    .where(inArray(UserAddressTable.postalCode, pincodesList));
};

export const upsertPincodesBatch = async (cleanPincodes) => {
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
};

export const getAllPincodes = async () => {
  return await db.select().from(pincodeServiceabilityTable).orderBy(pincodeServiceabilityTable.state, pincodeServiceabilityTable.city, pincodeServiceabilityTable.pincode);
};

export const getPincodeDetails = async (pincode) => {
  const [details] = await db
    .select()
    .from(pincodeServiceabilityTable)
    .where(eq(pincodeServiceabilityTable.pincode, pincode));
  return details;
};

export const updatePincode = async (pincode, data) => {
  const [updated] = await db
    .update(pincodeServiceabilityTable)
    .set(data)
    .where(eq(pincodeServiceabilityTable.pincode, pincode))
    .returning();
  return updated;
};

export const deletePincode = async (pincode) => {
  await db.delete(pincodeServiceabilityTable).where(eq(pincodeServiceabilityTable.pincode, pincode));
};

export const bulkUpdatePincodesList = async (pincodes, validUpdates) => {
  await db.update(pincodeServiceabilityTable)
    .set(validUpdates)
    .where(inArray(pincodeServiceabilityTable.pincode, pincodes));
};

export const bulkDeletePincodesList = async (pincodes) => {
  await db.delete(pincodeServiceabilityTable)
    .where(inArray(pincodeServiceabilityTable.pincode, pincodes));
};

export const executePincodeQuery = async (query) => {
  return await query.returning({ pincode: pincodeServiceabilityTable.pincode });
};
