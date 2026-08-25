import express from 'express';
import * as RBACController from './rbac.controller.js';
import { requireAuth, verifyAdmin, requirePermission } from '../../middleware/auth.js';

const router = express.Router();

// Apply auth to all routes
router.use(requireAuth);
router.use(verifyAdmin);

// Current Admin Capabilities
router.get('/me', (req, res) => {
  res.json({
    role: req.adminRole,
    permissions: req.adminPermissions
  });
});

// Permissions
router.get('/permissions', requirePermission('roles.view'), RBACController.getAllPermissions);

// Roles
router.get('/roles', requirePermission('roles.view'), RBACController.getAllRoles);
router.post('/roles', requirePermission('roles.manage'), RBACController.createRole);
router.put('/roles/:id', requirePermission('roles.manage'), RBACController.updateRole);
router.delete('/roles/:id', requirePermission('roles.manage'), RBACController.deleteRole);

// Administrators
router.get('/administrators', requirePermission('administrators.view'), RBACController.getAdministrators);
router.post('/assign', requirePermission('roles.assign'), RBACController.assignRole);

export default router;
