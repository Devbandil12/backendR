// routes/user.js
import express from "express";
import { db } from "../configs/index.js";
import { usersTable } from "../configs/schema.js";
import { eq } from "drizzle-orm";

const router = express.Router();

// Get user by email
router.get("/", async (req, res) => {
  try {
    const email = req.query.email;
    if (!email) return res.status(400).json({ error: "Email required" });

    const user = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, email));

    res.json(user[0] || null);
  } catch (error) {
    console.error("❌ Error fetching user:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// Create new user
router.post("/", async (req, res) => {
  try {
    const { name, email } = req.body;
    const [newUser] = await db
      .insert(usersTable)
      .values({ name, email, role: "user", cartLength: 0 })
      .returning();

    res.json(newUser);
  } catch (error) {
    console.error("❌ Error creating user:", error);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
