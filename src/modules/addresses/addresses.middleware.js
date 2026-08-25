import { db } from "../../db/client.js";
import { usersTable } from "../../db/schema/index.js";
import { eq } from "drizzle-orm";

export const resolveAndValidateUser = async (req, res, next) => {
  try {
    const user = await db.query.usersTable.findFirst({
        where: eq(usersTable.clerkId, req.auth.userId),
        columns: { id: true, role: true }
    });

    if (!user) return res.status(401).json({ error: "User not found" });

    req.userDbId = user.id;
    req.userRole = user.role;

    if (req.params.userId && req.params.userId !== user.id && user.role !== 'admin') {
        return res.status(403).json({ error: "Forbidden: Access Denied" });
    }

    if (req.body) {
        req.body.userId = user.id;
    }

    next();
  } catch (error) {
    console.error("Auth Resolution Error:", error);
    res.status(500).json({ error: "Internal Auth Error" });
  }
};
