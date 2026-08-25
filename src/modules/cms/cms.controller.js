// src/modules/cms/cms.controller.js
import * as cmsService from './cms.service.js';

export const getAllBanners = async (req, res) => {
  try {
    res.json(await cmsService.getAllBanners());
  } catch (error) {
    console.error('GET banners error:', error);
    res.status(500).json({ error: 'Failed to fetch banners' });
  }
};

export const createBanner = async (req, res) => {
  try {
    const newBanner = await cmsService.createBanner(req.body);
    res.status(201).json(newBanner);
  } catch (error) {
    console.error('POST banners error:', error);
    res.status(500).json({ error: 'Failed to add banner' });
  }
};

export const deleteBanner = async (req, res) => {
  try {
    await cmsService.deleteBanner(req.params.id);
    res.json({ success: true });
  } catch (error) {
    console.error('DELETE banners error:', error);
    res.status(500).json({ error: 'Failed to delete' });
  }
};

export const updateBanner = async (req, res) => {
  try {
    const updated = await cmsService.updateBanner(req.params.id, req.body);
    res.json(updated);
  } catch (error) {
    console.error('PUT banners error:', error);
    res.status(500).json({ error: 'Update failed' });
  }
};

export const getAboutUs = async (req, res) => {
  try {
    res.json(await cmsService.getAboutUs());
  } catch (error) {
    console.error('GET about error:', error);
    res.status(500).json({ error: 'Failed to fetch About Us' });
  }
};

export const upsertAboutUs = async (req, res) => {
  try {
    const { result, isNew } = await cmsService.upsertAboutUs(req.body);
    res.status(isNew ? 201 : 200).json(result);
  } catch (error) {
    console.error('POST about error:', error);
    res.status(500).json({ error: 'Failed to save About Us' });
  }
};
