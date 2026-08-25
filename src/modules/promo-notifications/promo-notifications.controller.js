// src/modules/promo-notifications/promo-notifications.controller.js
import * as promoService from './promo-notifications.service.js';

export const getLatestPublicPromos = async (req, res) => {
  try {
    const promos = await promoService.getLatestPublicPromos();
    res.json(promos);
  } catch (err) {
    console.error('Error fetching latest promos:', err);
    res.status(500).json({ error: 'Server error' });
  }
};
