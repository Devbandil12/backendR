import * as AnalyticsService from './analytics.service.js';

export const getFunnelStats = async (req, res) => {
  try {
    const funnel = await AnalyticsService.getFunnelStats();
    res.json(funnel);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const getTopReturnedProducts = async (req, res) => {
  try {
    const products = await AnalyticsService.getTopReturnedProducts();
    res.json(products);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

import { AnalyticsService as AdminAnalyticsService } from '../admin/analytics.service.js';

export const getSalesAnalytics = async (req, res) => {
  try {
    const { timeRange, startDate, endDate } = req.query;
    const data = await AdminAnalyticsService.getSalesAnalytics(timeRange, startDate, endDate);
    res.json(data);
  } catch (err) {
    console.error("Sales Analytics Error:", err);
    res.status(500).json({ error: err.message });
  }
};

export const getCustomerAnalytics = async (req, res) => {
  try {
    const { timeRange, startDate, endDate } = req.query;
    const data = await AdminAnalyticsService.getCustomerAnalytics(timeRange, startDate, endDate);
    res.json(data);
  } catch (err) {
    console.error("Customer Analytics Error:", err);
    res.status(500).json({ error: err.message });
  }
};

export const getProductAnalytics = async (req, res) => {
  try {
    const { timeRange, startDate, endDate } = req.query;
    const data = await AdminAnalyticsService.getProductAnalytics(timeRange, startDate, endDate);
    res.json(data);
  } catch (err) {
    console.error("Product Analytics Error:", err);
    res.status(500).json({ error: err.message });
  }
};

export const getInventoryAnalytics = async (req, res) => {
  try {
    const data = await AdminAnalyticsService.getInventoryAnalytics();
    res.json(data);
  } catch (err) {
    console.error("Inventory Analytics Error:", err);
    res.status(500).json({ error: err.message });
  }
};
