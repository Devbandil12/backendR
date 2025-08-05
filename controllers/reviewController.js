// src/contexts/UserContext.jsx
import React, { createContext, useState, useEffect } from "react";
import { useUser } from "@clerk/clerk-react";
import { db } from "../../configs";
import {
  usersTable,
  addressTable,
  UserAddressTable,
  ordersTable,
  orderItemsTable,
  productsTable,
} from "../../configs/schema";
import { eq } from "drizzle-orm";

// Create the context
export const UserContext = createContext();

export const UserProvider = ({ children }) => {
  const [userdetails, setUserdetails] = useState(null);
  const [address, setAddress] = useState([]);
  const [orders, setOrders] = useState([]);
  const { user } = useUser();

  // 🔍 Get or Create user in DB
  const getUserDetail = async () => {
    try {
      const email = user?.primaryEmailAddress?.emailAddress;
      const clerkId = user?.id;
      const name = `${user?.firstName || ""} ${user?.lastName || ""}`.trim();

      if (!email || !clerkId) {
        console.warn("❌ Clerk user missing email or ID");
        return;
      }

      console.log("🔍 Checking for user in DB:", email);

      const res = await db
        .select()
        .from(usersTable)
        .where(eq(usersTable.email, email));

      if (res.length > 0) {
        const dbUser = res[0];

        // ✅ Update missing clerkId
        if (!dbUser.clerkId) {
          await db
            .update(usersTable)
            .set({ clerkId })
            .where(eq(usersTable.id, dbUser.id));

          dbUser.clerkId = clerkId;
          console.log("🛠️ Added missing Clerk ID to user.");
        }

        setUserdetails(dbUser);
      } else {
        // 🆕 New user insert
        const [newUser] = await db
          .insert(usersTable)
          .values({
            name,
            email,
            role: "user",
            cartLength: 0,
            clerkId,
          })
          .returning();

        console.log("✅ New user inserted into DB");
        setUserdetails(newUser);
      }
    } catch (err) {
      console.error("❌ Error getting/creating user:", err);
    }
  };

  // 📦 Get user's orders
  const getMyOrders = async () => {
    if (!userdetails?.id) return;

    try {
      const res = await db
        .select({
          orderId: ordersTable.id,
          totalAmount: ordersTable.totalAmount,
          status: ordersTable.status,
          paymentMode: ordersTable.paymentMode,
          paymentStatus: ordersTable.paymentStatus,
          createdAt: ordersTable.createdAt,
          productId: orderItemsTable.productId,
          quantity: orderItemsTable.quantity,
          price: orderItemsTable.price,
          productName: productsTable.name,
          productImage: productsTable.imageurl,
        })
        .from(ordersTable)
        .innerJoin(orderItemsTable, eq(ordersTable.id, orderItemsTable.orderId))
        .innerJoin(productsTable, eq(orderItemsTable.productId, productsTable.id))
        .where(eq(ordersTable.userId, userdetails.id))
        .orderBy(ordersTable.createdAt);

      const groupedOrders = res.reduce((acc, item) => {
        const orderId = item.orderId;
        if (!acc[orderId]) {
          acc[orderId] = {
            orderId: item.orderId,
            totalAmount: item.totalAmount,
            status: item.status,
            createdAt: item.createdAt,
            paymentStatus: item.paymentStatus,
            paymentMode: item.paymentMode,
            items: [],
          };
        }
        acc[orderId].items.push({
          productId: item.productId,
          productName: item.productName,
          productImage: item.productImage,
          quantity: item.quantity,
          price: item.price,
        });
        return acc;
      }, {});

      setOrders(Object.values(groupedOrders));
    } catch (error) {
      console.error("❌ Failed to get orders:", error);
    }
  };

  // 🏠 Get legacy address (optional)
  const getAddress = async () => {
    try {
      const res = await db
        .select()
        .from(addressTable)
        .where(eq(addressTable.userId, userdetails?.id));
      console.log("🏠 Address (legacy):", res);
    } catch (error) {
      console.error("❌ Failed to get address:", error);
    }
  };

  // 🏠 Get user addresses
  const getUserAddress = async () => {
    try {
      const res = await db
        .select()
        .from(UserAddressTable)
        .where(eq(UserAddressTable.userId, userdetails?.id));
      setAddress(res);
    } catch (error) {
      console.error("❌ Failed to get user address:", error);
    }
  };

  // ⏳ Run on Clerk load
  useEffect(() => {
    if (user) getUserDetail();
  }, [user]);

  // ⏳ Run once userdetails is set
  useEffect(() => {
    if (userdetails) {
      getMyOrders();
      getAddress();
      getUserAddress();
    }
  }, [userdetails]);

  return (
    <UserContext.Provider
      value={{
        userdetails,
        setUserdetails,
        orders,
        address,
        setAddress,
      }}
    >
      {children}
    </UserContext.Provider>
  );
};
