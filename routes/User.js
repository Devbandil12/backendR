import express from "express";
import { db } from "../configs/index.js";
import { usersTable, ordersTable, orderItemsTable, productsTable, UserAddressTable } from "../configs/schema.js";
import { eq, asc, inArray, or } from "drizzle-orm";
import { cache, invalidateCache } from "../cacheMiddleware.js";

const router = express.Router();

// 1. Caching the admin panel route (This is fine with a static key)
router.get("/", cache("all-users", 3600), async (req, res) => {
  try {
    const allUsers = await db.query.usersTable.findMany({
      with: {
        orders: {
          with: {
            orderItems: true,
          },
        },
        addresses: true,
      },
    });
    res.json(allUsers);
  } catch (error) {
    console.error("❌ [BACKEND] Error fetching all users with details:", error);
    res.status(500).json({ error: "Internal Server Error", details: error.message });
  }
});

// 2. Caching the find-by-clerk-id route with a DYNAMIC key.
router.get("/find-by-clerk-id", cache(300), async (req, res) => {
  try {
    const { clerkId } = req.query;
    if (!clerkId) {
      return res.status(400).json({ error: "clerkId required for user lookup." });
    }

    const user = await db.query.usersTable.findFirst({
      where: eq(usersTable.clerkId, clerkId),
    });

    if (!user) return res.json(null);

    const userData = {
      ...user,
      profileImage: user.profileImage || null,
      dob: user.dob || null,
      gender: user.gender || null,
    };

    res.json(userData);
  } catch (error) {
    console.error("❌ [BACKEND] Error fetching user by clerkId:", error);
    res.status(500).json({ error: "Internal Server Error", details: error.message });
  }
});

// 3. Post endpoint for creating a user (Prevents duplicates)
router.post("/", async (req, res) => {
  try {
    const { name, email, clerkId } = req.body;

    // CRITICAL FIX: Check for an existing user by clerkId OR email to prevent duplicates.
    const existingUser = await db.query.usersTable.findFirst({
      where: or(
        eq(usersTable.clerkId, clerkId),
        eq(usersTable.email, email)
      ),
    });

    // If a user with that clerkId or email already exists, return that user.
    if (existingUser) {
      return res.status(200).json(existingUser);
    }

    // If no user was found, create a new one.
    const [newUser] = await db
      .insert(usersTable)
      .values({ name, email, clerkId })
      .returning();

    // Invalidate the 'all-users' list cache
    await invalidateCache("all-users");

    res.status(201).json(newUser);
  } catch (error) {
    console.error("❌ [BACKEND] Error creating user:", error);
    res.status(500).json({ error: "Internal Server Error", details: error.message });
  }
});

// 4. PUT endpoint for updating user details with proper cache invalidation
router.put("/:id", async (req, res) => {
  const { id } = req.params;
  try {
    // First, get the user's clerkId to invalidate the correct dynamic cache
    const userToUpdate = await db.query.usersTable.findFirst({
      columns: { clerkId: true },
      where: eq(usersTable.id, id),
    });

    if (!userToUpdate) {
      return res.status(404).json({ message: "User not found" });
    }

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

    // Proper cache invalidation
    await invalidateCache("all-users");
    await invalidateCache(`/api/users/find-by-clerk-id?clerkId=${userToUpdate.clerkId}`);

    res.json(updatedUser);
  } catch (err) {
    console.error("Failed to update user:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// 5. DELETE endpoint for a user with proper cache invalidation
router.delete("/:id", async (req, res) => {
  const { id } = req.params;
  try {
    // First, get the user's clerkId to invalidate the correct cache before deleting
    const userToDelete = await db.query.usersTable.findFirst({
      columns: { clerkId: true },
      where: eq(usersTable.id, id),
    });

    if (!userToDelete) {
      return res.status(404).json({ message: "User not found" });
    }

    await db.delete(usersTable).where(eq(usersTable.id, id));

    await invalidateCache("all-users");
    await invalidateCache(`/api/users/find-by-clerk-id?clerkId=${userToDelete.clerkId}`);

    res.status(204).send();
  } catch (err) {
    console.error("Failed to delete user:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// 6. Caching addresses route with a DYNAMIC key
router.get("/:id/addresses", cache(300), async (req, res) => {
  try {
    const userId = req.params.id;
    const addresses = await db
      .select()
      .from(UserAddressTable)
      .where(eq(UserAddressTable.userId, userId));
    res.json(addresses);
  } catch (error) {
    console.error("❌ [BACKEND] Failed to get user addresses:", error);
    res.status(500).json({ error: "Internal Server Error", details: error.message });
  }
});

// 7. Caching orders route with a DYNAMIC and specific key
router.get("/:userId/orders", cache(300), async (req, res) => {
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

    if (!orderQuery.length) {
      return res.json([]);
    }

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
          created_at:
            o.refundInitiatedAt
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
    console.error("❌ [BACKEND] Failed to get orders:", error);
    res.status(500).json({ error: "Internal Server Error", details: error.message });
  }
});

export default router;