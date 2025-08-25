// routes/contact.js
import express from "express";
import { db } from "../configs/index.js";
import { querytable } from "../configs/schema.js";
import { eq } from "drizzle-orm";

const router = express.Router();

// GET all queries
router.get("/", async (req, res) => {
  try {
    const queries = await db.select().from(querytable);
    res.json(queries);
  } catch (error) {
    console.error("❌ Error fetching queries:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// POST a new query
router.post("/", async (req, res) => {
  const queryData = req.body;
  try {
    const [newQuery] = await db
      .insert(querytable)
      .values({
        ...queryData,
        createdAt: new Date().toISOString(),
      })
      .returning();
    res.status(201).json(newQuery);
  } catch (error) {
    console.error("❌ Error adding query:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// DELETE a query by ID
router.delete("/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const [deletedQuery] = await db
      .delete(querytable)
      .where(eq(querytable.id, Number(id)))
      .returning();

    if (!deletedQuery) {
      return res.status(404).json({ error: "Query not found." });
    }

    res.json({ message: "Query deleted successfully." });
  } catch (error) {
    console.error("❌ Error deleting query:", error);
    res.status(500).json({ error: "Server error" });
  }
});


// GET /api/contact/user/:email
router.get("/user/:email", async (req, res) => {
    try {
        const { email } = req.params;
        const queries = await db.select().from(querytable).where(eq(querytable.email, email));
        res.json(queries);
    } catch (error) {
        console.error("❌ Error fetching user queries:", error);
        res.status(500).json({ error: "Server error" });
    }
});




export default router;
