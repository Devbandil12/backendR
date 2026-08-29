// src/modules/users/users.controller.js
import * as usersService from './users.service.js';

// getAdminLogs moved to audit module

export const getAllUsers = async (req, res) => {
  try {
    const { page, limit, search } = req.query;
    res.setHeader('Cache-Control', 'no-store');
    res.json(await usersService.getAllUsers(Number(page) || 1, Number(limit) || 20, search || ''));
  } catch (error) {
    console.error('❌ Error fetching all users:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

export const getCurrentUser = async (req, res) => {
  try {
    res.json(await usersService.getUserByClerkId(req.auth.userId));
  } catch (error) {
    console.error('❌ Error fetching user profile:', error);
    res.status(error.status || 500).json({ error: error.message || 'Internal Server Error' });
  }
};

export const createUser = async (req, res) => {
  try {
    const { name, email, clerkId } = req.body;
    if (req.auth.userId !== clerkId) return res.status(403).json({ error: 'Identity mismatch' });
    const user = await usersService.createUser(clerkId, name, email);
    res.status(201).json(user);
  } catch (error) {
    console.error('❌ Error creating user:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

export const updateUser = async (req, res) => {
  try {
    const updated = await usersService.updateUser(req.auth.userId, req.params.id, req.body);
    res.json(updated);
  } catch (error) {
    console.error('❌ Error updating user:', error);
    res.status(error.status || 500).json({ error: error.message || 'Internal Server Error' });
  }
};

export const deleteUser = async (req, res) => {
  try {
    await usersService.deleteUser(req.auth.userId, req.params.id);
    res.sendStatus(204);
  } catch (error) {
    console.error('❌ Error deleting user:', error);
    res.status(error.status || 500).json({ error: error.message || 'Internal Server Error' });
  }
};

// getUserLogs reinstated for the frontend UserPage
export const getUserLogs = async (req, res) => {
  try {
    const { id } = req.params;
    // ensure users can only see their own logs unless admin
    const requester = await usersService.getUserByClerkId(req.auth.userId);
    
    // We can't strictly check admin here without RBAC, but we can enforce that 
    // the requested log ID must match the requester's DB ID.
    if (requester.id !== id) {
       return res.status(403).json({ error: 'Forbidden' });
    }

    // Dynamic import to avoid circular dependencies and get AuditRepository
    const AuditRepository = await import('../../infrastructure/audit/audit.repository.js');
    const logs = await AuditRepository.getAuditLogs({ actorUserId: id }, null, 50);
    
    // Frontend expects an array directly or { success, data }
    // UserPage: setPersonalLogs(Array.isArray(data) ? data : []);
    res.json(logs);
  } catch (error) {
    console.error('❌ Error fetching user logs:', error);
    res.status(error.status || 500).json({ error: error.message || 'Internal Server Error' });
  }
};

export const getUserAddresses = async (req, res) => {
  try {
    res.json(await usersService.getUserAddresses(req.auth.userId, req.params.id));
  } catch (error) {
    console.error('❌ Error fetching user addresses:', error);
    res.status(error.status || 500).json({ error: error.message || 'Internal Server Error' });
  }
};

export const getUserOrders = async (req, res) => {
  try {
    res.json(await usersService.getUserOrders(req.auth.userId, req.params.userId));
  } catch (error) {
    console.error('❌ Error fetching user orders:', error);
    res.status(error.status || 500).json({ error: error.message || 'Internal Server Error' });
  }
};
