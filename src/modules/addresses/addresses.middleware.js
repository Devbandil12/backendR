import { getUserWithRole } from "../../middleware/rbac.js";

export const resolveAndValidateUser = async (req, res, next) => {
  try {
    const user = await getUserWithRole(req.auth.userId);

    if (!user) return res.status(401).json({ error: "User not found" });

    req.userDbId = user.id;
    req.userRole = user.role;

    if (req.params.userId && req.params.userId !== user.id && user.role !== 'admin' && !user.adminRole) {
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
