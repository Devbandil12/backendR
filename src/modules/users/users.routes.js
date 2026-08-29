// src/modules/users/users.routes.js
import express from 'express';
import { requireAuth, verifyAdmin } from '../../middleware/auth.js';
import { cache } from '../../infrastructure/cache/cache.service.js';
import { makeAllUsersKey, makeUserAddressesKey, makeUserOrdersKey } from '../../infrastructure/cache/cache.keys.js';
import * as usersController from './users.controller.js';

const router = express.Router();

// /admin/all-activity-logs route deprecated in favor of /api/admin/audit-logs in audit module
router.get('/', requireAuth, verifyAdmin, cache(makeAllUsersKey(), 3600), usersController.getAllUsers);
router.get('/me', requireAuth, usersController.getCurrentUser);
router.get('/find-by-clerk-id', requireAuth, usersController.getCurrentUser);
router.post('/', requireAuth, usersController.createUser);
router.put('/:id', requireAuth, usersController.updateUser);
router.delete('/:id', requireAuth, usersController.deleteUser);
// User's personal activity logs
router.get('/:id/logs', requireAuth, usersController.getUserLogs);
router.get('/:id/addresses', requireAuth, cache((req) => makeUserAddressesKey(req.params.id), 300), usersController.getUserAddresses);
router.get('/:userId/orders', requireAuth, cache((req) => makeUserOrdersKey(req.params.userId), 300), usersController.getUserOrders);

export default router;
