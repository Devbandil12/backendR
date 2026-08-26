import * as siteService from './site.service.js';
import { WaitlistService } from './waitlist.service.js';

export const getSiteStatus = async (req, res) => {
  try {
    const status = await siteService.getSiteStatus();
    // Expose serverTime dynamically on every request so countdown is accurate
    status.serverTime = new Date();
    res.json(status);
  } catch (error) {
    console.error('❌ getSiteStatus:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

export const updateSiteStatus = async (req, res) => {
  try {
    const updated = await siteService.updateSiteStatus(req.auth.userId, req.body);
    res.json(updated);
  } catch (error) {
    console.error('❌ updateSiteStatus:', error);
    res.status(error.status || 500).json({ error: error.message || 'Server error', message: error.message });
  }
};

export const getAnnouncements = async (req, res) => {
  try {
    const announcements = await siteService.getActiveAnnouncements();
    res.json(announcements);
  } catch (error) {
    console.error('❌ getAnnouncements:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

export const createAnnouncement = async (req, res) => {
  try {
    const announcement = await siteService.createAnnouncement(req.auth.userId, req.body);
    res.status(201).json(announcement);
  } catch (error) {
    console.error('❌ createAnnouncement:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

export const subscribeWaitlist = async (req, res) => {
  try {
    const result = await WaitlistService.subscribe(req.body.email);
    const statusCode = result.alreadySubscribed ? 200 : 201;
    res.status(statusCode).json(result);
  } catch (error) {
    const status = error.status || 500;
    res.status(status).json({ error: error.message, message: error.message });
  }
};

export const getWaitlist = async (req, res) => {
  try {
    const data = await WaitlistService.getSubscribers(req.query);
    res.json(data);
  } catch (error) {
    console.error('❌ getWaitlist:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

export const exportWaitlist = async (req, res) => {
  try {
    const csv = await WaitlistService.exportCSV();
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="devidaura-launch-waitlist.csv"');
    res.send(csv);
  } catch (error) {
    console.error('❌ exportWaitlist:', error);
    res.status(500).json({ error: 'Server error' });
  }
};

