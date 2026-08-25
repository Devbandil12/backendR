import * as siteService from './site.service.js';

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
    res.status(500).json({ error: 'Server error' });
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
