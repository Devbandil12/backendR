// src/modules/bundles/bundles.controller.js
import * as bundlesService from './bundles.service.js';

export const getBundleContents = async (req, res) => {
  try {
    const contents = await bundlesService.getBundleContents(req.params.bundleVariantId);
    res.json(contents);
  } catch (error) {
    console.error('❌ Error fetching bundle contents:', error);
    res.status(error.status || 500).json({ error: error.message || 'Server error' });
  }
};

export const addBundleItem = async (req, res) => {
  const { bundleVariantId, contentVariantId, quantity } = req.body;
  if (!bundleVariantId || !contentVariantId || !quantity) {
    return res.status(400).json({ error: 'bundleVariantId, contentVariantId, and quantity are required.' });
  }
  
  try {
    const newEntry = await bundlesService.addBundleItem(req.auth.userId, bundleVariantId, contentVariantId, quantity);
    res.status(201).json(newEntry);
  } catch (error) {
    console.error('❌ Error adding to bundle:', error);
    res.status(error.status || 500).json({ error: error.message || 'Server error' });
  }
};

export const removeBundleItem = async (req, res) => {
  try {
    const deletedEntry = await bundlesService.removeBundleItem(req.auth.userId, req.params.bundleEntryId);
    res.json({ success: true, deletedEntry });
  } catch (error) {
    console.error('❌ Error removing from bundle:', error);
    res.status(error.status || 500).json({ error: error.message || 'Server error' });
  }
};
