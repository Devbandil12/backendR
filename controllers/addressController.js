// src/controllers/addressController.js
import { db } from '../configs/index.js';
import { UserAddressTable } from '../configs/schema.js';
import { eq, and } from "drizzle-orm";

/**
 * POST /api/address/save
 * Body: { userId, address }
 *
 * If an address with the same postalCode already exists for the user
 * ⇒ update it. Otherwise insert a new row.
 */
export async function saveAddress(req, res) {
  try {
    const { userId, address } = req.body;
    if (!userId || !address?.postalCode) {
      return res.status(400).json({ success: false, msg: "Missing fields" });
    }

    // Does this user already have an address with the same postalCode?
    const [existing] = await db
      .select()
      .from(UserAddressTable)
      .where(
        and(
          eq(UserAddressTable.userId, userId),
          eq(UserAddressTable.postalCode, address.postalCode)
        )
      );

    if (existing) {
      // Update
      await db
        .update(UserAddressTable)
        .set({ ...address })
        .where(eq(UserAddressTable.id, existing.id));
    } else {
      // Insert
      await db.insert(UserAddressTable).values({ ...address, userId });
    }

    return res.json({ success: true });
  } catch (err) {
    console.error("saveAddress error:", err);
    return res.status(500).json({ success: false, msg: "Server error" });
  }
}

/**
 * POST /api/address/delete
 * Body: { userId, postalCode }
 *
 * Deletes the address row that matches userId + postalCode
 */
export async function deleteAddress(req, res) {
  try {
    const { userId, postalCode } = req.body;
    if (!userId || !postalCode) {
      return res.status(400).json({ success: false, msg: "Missing fields" });
    }

    await db
      .delete(UserAddressTable)
      .where(
        and(
          eq(UserAddressTable.userId, userId),
          eq(UserAddressTable.postalCode, postalCode)
        )
      );

    return res.json({ success: true });
  } catch (err) {
    console.error("deleteAddress error:", err);
    return res.status(500).json({ success: false, msg: "Server error" });
  }
}