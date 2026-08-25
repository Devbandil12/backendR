import { 
  getIntelligenceOverview,
  getCustomerProductIntelligence,
  getMarketIntelligence
} from './intelligence.service.js';

export const getOverview = async (req, res, next) => {
  try {
    const { timeRange, startDate, endDate } = req.query;
    const data = await getIntelligenceOverview(timeRange, startDate, endDate);
    res.status(200).json(data);
  } catch (error) {
    next(error);
  }
};

export const getCustomerProduct = async (req, res, next) => {
  try {
    const { timeRange, startDate, endDate } = req.query;
    const data = await getCustomerProductIntelligence(timeRange, startDate, endDate);
    res.status(200).json(data);
  } catch (error) {
    next(error);
  }
};

export const getMarket = async (req, res, next) => {
  try {
    const { timeRange, startDate, endDate } = req.query;
    const data = await getMarketIntelligence(timeRange, startDate, endDate);
    res.status(200).json(data);
  } catch (error) {
    next(error);
  }
};
