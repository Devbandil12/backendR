// ✅ file: routes/users.js

import express from "express";
import { db } from "../configs/index.js";
import {
  usersTable,
  ordersTable,
  orderItemsTable,
  productsTable,
  UserAddressTable,
} from "../configs/schema.js";
import { eq, asc, inArray, or } from "drizzle-orm";

// 🟢 Import caching utilities
import { cache } from "../cacheMiddleware.js";
import { invalidateMultiple } from "../invalidateHelpers.js";
import { makeAllUsersKey, makeFindByClerkIdKey, makeUserAddressesKey, makeUserOrdersKey } from "../cacheKeys.js";

const router = express.Router();

/* ======================================================
   🟢 GET ALL USERS (Admin)
   Cache Key: users:all
   TTL: 1 hour
====================================================== */
router.get("/", cache(makeAllUsersKey(), 3600), async (req, res) => {
  try {
    const allUsers = await db.query.usersTable.findMany({
      with: {
        orders: { with: { orderItems: true } },
        addresses: true,
      },
    });

    res.json(allUsers);
  } catch (error) {
    console.error("❌ Error fetching all users:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

/* ======================================================
   🟢 GET USER BY CLERK ID
   Cache Key: users:find-by-clerk-id:clerkId=<id>
   TTL: 5 minutes
====================================================== */
router.get(
  "/find-by-clerk-id",
  cache((req) => makeFindByClerkIdKey(req.query.clerkId), 300),
  async (req, res) => {
    try {
      const { clerkId } = req.query;
      if (!clerkId) {
        return res.status(400).json({ error: "clerkId is required" });
      }

      const user = await db.query.usersTable.findFirst({
        where: eq(usersTable.clerkId, clerkId),
      });

      if (!user) return res.status(404).json({ message: "User not found" });

      res.json({
        ...user,
        profileImage: user.profileImage || null,
        dob: user.dob || null,
        gender: user.gender || null,
      });
    } catch (error) {
      console.error("❌ Error fetching user by clerkId:", error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  }
);

/* ======================================================
   🟢 CREATE USER
   Invalidates: users:all, users:find-by-clerk-id:<id>
====================================================== */
router.post("/", async (req, res) => {
  try {
    const { name, email, clerkId } = req.body;

    const existingUser = await db.query.usersTable.findFirst({
      where: or(eq(usersTable.clerkId, clerkId), eq(usersTable.email, email)),
    });

    if (existingUser) return res.status(200).json(existingUser);

    const [newUser] = await db.insert(usersTable).values({ name, email, clerkId }).returning();

    await invalidateMultiple([
      makeAllUsersKey(),
      makeFindByClerkIdKey(clerkId),
    ]);

    res.status(201).json(newUser);
  } catch (error) {
    console.error("❌ Error creating user:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

/* ======================================================
   🟢 UPDATE USER
   Invalidates: users:all, users:find-by-clerk-id:<id>
====================================================== */
router.put("/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const userToUpdate = await db.query.usersTable.findFirst({
      columns: { clerkId: true },
      where: eq(usersTable.id, id),
    });

    if (!userToUpdate) return res.status(404).json({ message: "User not found" });

    const { profileImage, dob, gender, ...rest } = req.body;

    const [updatedUser] = await db
      .update(usersTable)
      .set({
        ...rest,
        ...(profileImage !== undefined && { profileImage }),
        ...(dob !== undefined && { dob: new Date(dob) }),
        ...(gender !== undefined && { gender }),
      })
      .where(eq(usersTable.id, id))
      .returning();

    await invalidateMultiple([
      makeAllUsersKey(),
      makeFindByClerkIdKey(userToUpdate.clerkId),
    ]);

    res.json(updatedUser);
  } catch (error) {
    console.error("❌ Error updating user:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

/* ======================================================
   🟢 DELETE USER
   Invalidates: users:all, users:find-by-clerk-id:<id>
====================================================== */
router.delete("/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const userToDelete = await db.query.usersTable.findFirst({
      columns: { clerkId: true },
      where: eq(usersTable.id, id),
    });

    if (!userToDelete) return res.status(404).json({ message: "User not found" });

    await db.delete(usersTable).where(eq(usersTable.id, id));

    await invalidateMultiple([
      makeAllUsersKey(),
      makeFindByClerkIdKey(userToDelete.clerkId),
    ]);

    res.sendStatus(204);
  } catch (error) {
    console.error("❌ Error deleting user:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

/* ======================================================
   🟢 GET USER ADDRESSES
   Cache Key: users:addresses:userId=<id>
   TTL: 5 minutes
====================================================== */
router.get(
  "/:id/addresses",
  cache((req) => makeUserAddressesKey(req.params.id), 300),
  async (req, res) => {
    try {
      const { id } = req.params;

      const addresses = await db
        .select()
        .from(UserAddressTable)
        .where(eq(UserAddressTable.userId, id));

      res.json(addresses);
    } catch (error) {
      console.error("❌ Error fetching user addresses:", error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  }
);

/* ======================================================
   🟢 GET USER ORDERS
   Cache Key: orders:user:userId=<id>
   TTL: 5 minutes
====================================================== */
router.get(
  "/:userId/orders",
  cache((req) => makeUserOrdersKey(req.params.userId), 300),
  async (req, res) => {
    try {
      const { userId } = req.params;

      const orderQuery = await db
        .select({
          phone: ordersTable.phone,
          orderId: ordersTable.id,
          userId: ordersTable.userId,
          userName: usersTable.name,
          email: usersTable.email,
          paymentMode: ordersTable.paymentMode,
          totalAmount: ordersTable.totalAmount,
          paymentStatus: ordersTable.paymentStatus,
          transactionId: ordersTable.transactionId,
          status: ordersTable.status,
          progressStep: ordersTable.progressStep,
          createdAt: ordersTable.createdAt,
          address: ordersTable.address,
          city: ordersTable.city,
          state: ordersTable.state,
          zip: ordersTable.zip,
          country: ordersTable.country,
          refundId: ordersTable.refund_id,
          refundAmount: ordersTable.refund_amount,
          refundStatus: ordersTable.refund_status,
          refundSpeed: ordersTable.refund_speed,
          refundInitiatedAt: ordersTable.refund_initiated_at,
          refundCompletedAt: ordersTable.refund_completed_at,
        })
        .from(ordersTable)
        .innerJoin(usersTable, eq(ordersTable.userId, usersTable.id))
        .where(eq(ordersTable.userId, userId))
        .orderBy(asc(ordersTable.createdAt));

      if (!orderQuery.length) return res.json([]);

      const orderIds = orderQuery.map((o) => o.orderId);

      const productQuery = await db
        .select({
          orderId: orderItemsTable.orderId,
          productId: orderItemsTable.productId,
          quantity: orderItemsTable.quantity,
          oprice: productsTable.oprice,
          discount: productsTable.discount,
          productName: productsTable.name,
          img: productsTable.imageurl,
          size: productsTable.size,
        })
        .from(orderItemsTable)
        .innerJoin(productsTable, eq(orderItemsTable.productId, productsTable.id))
        .where(inArray(orderItemsTable.orderId, orderIds));

      const map = new Map();
      orderQuery.forEach((o) => {
        map.set(o.orderId, {
          ...o,
          refund: {
            id: o.refundId,
            amount: o.refundAmount,
            status: o.refundStatus,
            speedProcessed: o.refundSpeed,
            created_at: o.refundInitiatedAt
              ? new Date(o.refundInitiatedAt).getTime() / 1000
              : null,
            processed_at:
              o.refundCompletedAt
                ? Math.floor(new Date(o.refundCompletedAt).getTime() / 1000)
                : o.refundStatus === "processed"
                  ? Math.floor(Date.now() / 1000)
                  : null,
          },
          items: [],
        });
      });

      productQuery.forEach((p) => {
        const entry = map.get(p.orderId);
        if (entry) entry.items.push(p);
      });

      res.json(Array.from(map.values()));
    } catch (error) {
      console.error("❌ Error fetching user orders:", error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  }
);

export default router;
