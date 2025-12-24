// ✅ file: routes/User.js

import express from "express";
import { db } from "../configs/index.js";
import {
  usersTable,
  ordersTable,
  orderItemsTable,
  productsTable,
  UserAddressTable,
  activityLogsTable, 
} from "../configs/schema.js";
import { eq, asc, desc, inArray, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { cache } from "../cacheMiddleware.js";
import { invalidateMultiple } from "../invalidateHelpers.js";
import { makeAllUsersKey, makeFindByClerkIdKey, makeUserAddressesKey, makeUserOrdersKey } from "../cacheKeys.js";

const router = express.Router();

/* ======================================================
   🟢 GET ALL ADMIN LOGS (Strictly for Admin Panel)
====================================================== */
router.get("/admin/all-activity-logs", async (req, res) => {
  try {
    const targetUserTable = alias(usersTable, "target_user");

    const adminLogs = await db
      .select({
        id: activityLogsTable.id,
        action: activityLogsTable.action,
        description: activityLogsTable.description,
        createdAt: activityLogsTable.createdAt,
        performedBy: activityLogsTable.performedBy,
        metadata: activityLogsTable.metadata,
        
        actorName: usersTable.name,
        actorEmail: usersTable.email,
        actorImage: usersTable.profileImage,

        targetName: targetUserTable.name,
        targetEmail: targetUserTable.email,
      })
      .from(activityLogsTable)
      .leftJoin(usersTable, eq(activityLogsTable.userId, usersTable.id))
      .leftJoin(targetUserTable, eq(activityLogsTable.targetId, targetUserTable.id))
      .where(eq(activityLogsTable.performedBy, 'admin'))
      .orderBy(desc(activityLogsTable.createdAt))
      .limit(100);

    const formattedLogs = adminLogs.map(log => ({
        ...log,
        actor: {
            name: log.actorName || 'Unknown Admin',
            email: log.actorEmail,
            profileImage: log.actorImage
        },
        target: {
            name: log.targetName, 
            email: log.targetEmail
        }
    }));

    res.json(formattedLogs);
  } catch (error) {
    console.error("❌ Error fetching admin logs:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

/* ======================================================
   🟢 GET ALL USERS (Admin)
====================================================== */
router.get("/", cache(makeAllUsersKey(), 3600), async (req, res) => {
  try {
    res.setHeader('Cache-Control', 'no-store'); // Prevent browser caching

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
   GET USER BY CLERK ID
====================================================== */
router.get(
  "/find-by-clerk-id",
  cache((req) => makeFindByClerkIdKey(req.query.clerkId), 300),
  async (req, res) => {
    try {
      const { clerkId } = req.query;
      if (!clerkId) return res.status(400).json({ error: "clerkId is required" });

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
====================================================== */
router.post("/", async (req, res) => {
  try {
    const { name, email, clerkId } = req.body;

    const existingUser = await db.query.usersTable.findFirst({
      where: or(eq(usersTable.clerkId, clerkId), eq(usersTable.email, email)),
    });

    if (existingUser) return res.status(200).json(existingUser);

    const [newUser] = await db.insert(usersTable).values({ name, email, clerkId }).returning();

    // Log account creation (Self-action, so userId is new user)
    await db.insert(activityLogsTable).values({
      userId: newUser.id,
      action: 'ACCOUNT_CREATED',
      description: 'Account successfully created',
      performedBy: 'user'
    });

    await invalidateMultiple([
      { key: makeAllUsersKey() },
      { key: makeFindByClerkIdKey(clerkId) },
    ]);

    res.status(201).json(newUser);
  } catch (error) {
    console.error("❌ Error creating user:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

/* ======================================================
   🟢 UPDATE USER (Logs to ACTOR)
====================================================== */
router.put("/:id", async (req, res) => {
  const { id } = req.params; // Target User ID

  try {
    const userToUpdate = await db.query.usersTable.findFirst({
      columns: { 
          clerkId: true, 
          email: true,
          role: true,
          name: true 
      },
      where: eq(usersTable.id, id),
    });

    if (!userToUpdate) return res.status(404).json({ message: "User not found" });

    // Extract 'actorId' (Who is doing the update?)
    const { profileImage, dob, gender, role, actorId, ...rest } = req.body;

    const [updatedUser] = await db
      .update(usersTable)
      .set({
        ...rest,
        ...(role !== undefined && { role }), 
        ...(profileImage !== undefined && { profileImage }),
        ...(dob !== undefined && { dob: new Date(dob) }),
        ...(gender !== undefined && { gender }),
      })
      .where(eq(usersTable.id, id))
      .returning();

    // --- LOGGING LOGIC ---
    const changes = [];
    if (req.body.name && req.body.name !== userToUpdate.name) changes.push("Name");
    if (req.body.phone && req.body.phone !== userToUpdate.phone) changes.push("Phone");
    if (role && role !== userToUpdate.role) changes.push(`Role (${userToUpdate.role} → ${role})`);

    if (changes.length > 0) {
      const isRoleChange = changes.some(c => c.startsWith("Role"));
      
      const logUserId = actorId || id; 

      await db.insert(activityLogsTable).values({
        userId: logUserId, 
        targetId: id,
        
        action: isRoleChange ? 'ADMIN_UPDATE' : 'PROFILE_UPDATE', 
        description: `Updated ${userToUpdate.email}: ${changes.join(', ')}`,
        
        performedBy: isRoleChange ? 'admin' : 'user', 
        metadata: { 
            changes,
            targetUserId: id 
        }
      });
    }

    await invalidateMultiple([
      { key: makeAllUsersKey() }, 
      { key: makeFindByClerkIdKey(userToUpdate.clerkId) }, 
    ]);

    res.json(updatedUser);
  } catch (error) {
    console.error("❌ Error updating user:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

/* ======================================================
   DELETE USER
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
      { key: makeAllUsersKey() },
      { key: makeFindByClerkIdKey(userToDelete.clerkId) },
    ]);

    res.sendStatus(204);
  } catch (error) {
    console.error("❌ Error deleting user:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

/* ======================================================
   🟢 GET LOGS FOR SPECIFIC USER (Strictly My Actions)
   - Only shows actions performed BY the user (userId = id).
   - Removes actions performed ON the user by others (targetId = id).
   - If User is Admin, shows their Admin actions too (Only Theirs).
====================================================== */
router.get("/:id/logs", async (req, res) => {
    try {
      const { id } = req.params;
      
      const targetUserTable = alias(usersTable, "target_user");

      const logs = await db
        .select({
            id: activityLogsTable.id,
            action: activityLogsTable.action,
            description: activityLogsTable.description,
            createdAt: activityLogsTable.createdAt,
            performedBy: activityLogsTable.performedBy,
            metadata: activityLogsTable.metadata,
            
            actorName: usersTable.name,
            actorImage: usersTable.profileImage,

            targetName: targetUserTable.name,
        })
        .from(activityLogsTable)
        .leftJoin(usersTable, eq(activityLogsTable.userId, usersTable.id))
        .leftJoin(targetUserTable, eq(activityLogsTable.targetId, targetUserTable.id))
        .where(
            eq(activityLogsTable.userId, id) // 🟢 STRICT FILTER: Only actions I performed
        )
        .orderBy(desc(activityLogsTable.createdAt))
        .limit(50); 

      const formattedLogs = logs.map(log => ({
          id: log.id,
          type: 'security',
          action: log.action,
          description: log.description,
          createdAt: log.createdAt,
          performedBy: log.performedBy,
          actor: { 
            name: log.actorName || 'You', 
            profileImage: log.actorImage 
          },
          target: { name: log.targetName }, // Useful if I (Admin) updated someone else
          metadata: log.metadata
      }));

      res.json(formattedLogs);
    } catch (error) {
      console.error("❌ Error fetching logs:", error);
      res.status(500).json({ error: "Internal Server Error" });
    }
});

/* ======================================================
   GET USER ADDRESSES & ORDERS (Unchanged)
====================================================== */
router.get(
  "/:id/addresses",
  cache((req) => makeUserAddressesKey(req.params.id), 300),
  async (req, res) => {
    try {
      const { id } = req.params;
      const addresses = await db.select().from(UserAddressTable).where(eq(UserAddressTable.userId, id));
      res.json(addresses);
    } catch (error) {
      console.error("❌ Error fetching user addresses:", error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  }
);

router.get(
  "/:userId/orders",
  cache((req) => makeUserOrdersKey(req.params.userId), 300),
  async (req, res) => {
    try {
      const { userId } = req.params;
      const orderQuery = await db.select({
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

      const productQuery = await db.select({
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
            created_at: o.refundInitiatedAt ? new Date(o.refundInitiatedAt).getTime() / 1000 : null,
            processed_at: o.refundCompletedAt ? Math.floor(new Date(o.refundCompletedAt).getTime() / 1000) : o.refundStatus === "processed" ? Math.floor(Date.now() / 1000) : null,
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