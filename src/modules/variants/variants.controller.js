// src/modules/variants/variants.controller.js
import * as variantsService from './variants.service.js';

export const updateVariant = async (req, res) => {
  const { name, size, oprice, discount, costPrice, stock, sold, sku, isArchived, weight, length, breadth, height } = req.body;
  const variantData = { name, size, oprice, discount, costPrice, stock, sold, sku, isArchived, weight, length, breadth, height };
  Object.keys(variantData).forEach(k => variantData[k] === undefined && delete variantData[k]);
  
  if (Object.keys(variantData).length === 0) {
    return res.status(400).json({ error: 'No valid variant fields to update.' });
  }

  try {
    const updated = await variantsService.updateVariant(req.auth.userId, req.params.variantId, variantData);
    res.json(updated);
  } catch (err) {
    console.error('❌ Error updating variant:', err);
    res.status(err.status || 500).json({ error: err.message || 'Server error' });
  }
};

export const createVariant = async (req, res) => {
  if (!req.body.productId) return res.status(400).json({ error: 'productId is required.' });
  
  try {
    const newVariant = await variantsService.createVariant(req.auth.userId, req.body);
    res.status(201).json(newVariant);
  } catch (err) {
    console.error('❌ Error adding variant:', err);
    res.status(err.status || 500).json({ error: err.message || 'Server error' });
  }
};

export const archiveVariant = async (req, res) => {
  try {
    await variantsService.archiveVariant(req.auth.userId, req.params.variantId);
    res.json({ success: true, message: 'Variant archived.' });
  } catch (err) {
    console.error('❌ Error archiving variant:', err);
    res.status(err.status || 500).json({ error: err.message || 'Server error' });
  }
};

export const unarchiveVariant = async (req, res) => {
  try {
    await variantsService.unarchiveVariant(req.auth.userId, req.params.variantId);
    res.json({ success: true, message: 'Variant unarchived.' });
  } catch (err) {
    console.error('❌ Error unarchiving variant:', err);
    res.status(err.status || 500).json({ error: err.message || 'Server error' });
  }
};
