import { redis } from '../../config/redis.js';
import { 
  getWishlistCount, 
  getOrdersCount, 
  getAverageRating, 
  getReturnStats,
  getProductSignals,
  getProductsWithStock,
  getPaymentStats
} from './intelligence.repository.js';
import { resolvePeriod } from '../analytics/analyticsPeriod.js';
import { RULES, detectOpportunities, detectRisks, evaluateConfidence } from './intelligence.rules.js';
import { INTELLIGENCE_CACHE_TTLS as TTLS } from './intelligence.constants.js';
import { invalidateCache } from '../../infrastructure/cache/cache.service.js';

const getCachedOrFetch = async (key, ttl, fetcher) => {
  if (redis) {
    try {
      const cached = await redis.get(key);
      if (cached) return JSON.parse(cached);
    } catch (err) {
      console.warn(`Redis get error for ${key}:`, err);
    }
  }
  
  const data = await fetcher();
  
  if (redis) {
    try {
      await redis.setex(key, ttl, JSON.stringify(data));
    } catch (err) {
      console.warn(`Redis set error for ${key}:`, err);
    }
  }
  
  return data;
};

// 1. OVERVIEW (Summary, Opportunities, Risks, Emerging Trends)
export const getIntelligenceOverview = async (range, customStartDate, customEndDate) => {
  const period = resolvePeriod(range, customStartDate, customEndDate);
  const cacheKey = `intel:overview:${range}:${period.current.start.getTime()}:${period.current.end.getTime()}`;

  return getCachedOrFetch(cacheKey, TTLS.OVERVIEW, async () => {
    // Fetch current vs previous period data
    const [
      currWishlist, prevWishlist,
      currOrders, prevOrders,
      currRating, prevRating,
      currReturns, prevReturns,
      currPayments, prevPayments,
      productSalesWishlists,
      productsWithStock
    ] = await Promise.all([
      getWishlistCount(period.current.start, period.current.end),
      getWishlistCount(period.previous.start, period.previous.end),
      getOrdersCount(period.current.start, period.current.end),
      getOrdersCount(period.previous.start, period.previous.end),
      getAverageRating(period.current.start, period.current.end),
      getAverageRating(period.previous.start, period.previous.end),
      getReturnStats(period.current.start, period.current.end),
      getReturnStats(period.previous.start, period.previous.end),
      getPaymentStats(period.current.start, period.current.end),
      getPaymentStats(period.previous.start, period.previous.end),
      getProductSignals(period.current.start, period.current.end),
      getProductsWithStock()
    ]);

    // Summary calculations
    const demandGrowth = prevOrders === 0 ? 0 : ((currOrders - prevOrders) / prevOrders) * 100;
    const sentimentChange = currRating.avg - prevRating.avg;
    const currReturnRate = currReturns.totalOrders > 0 ? (currReturns.totalReturns / currReturns.totalOrders) * 100 : 0;
    const prevReturnRate = prevReturns.totalOrders > 0 ? (prevReturns.totalReturns / prevReturns.totalOrders) * 100 : 0;
    const currCodRto = currPayments.codOrders > 0 ? (currPayments.codRto / currPayments.codOrders) * 100 : 0;

    // Opportunities
    const productSignalsForRules = productSalesWishlists.wishlists.map(w => {
      const prodId = w.productId;
      const productObj = productsWithStock.find(p => p.id === prodId) || {};
      const salesObj = productSalesWishlists.sales.find(s => s.productId === prodId);
      
      // We don't have prev wishlist by product in this simple aggregation, 
      // but we could mock a demand growth for the rule based on overall growth if needed,
      // or we just use current wishlist count as a proxy for this example.
      return {
        productName: productObj.name || 'Unknown Product',
        demandGrowthPct: demandGrowth, // Using global demand growth as placeholder for individual for now
        stock: productObj.stock || 0,
        demandSampleSize: w.wishlists
      };
    });

    const opportunities = detectOpportunities(productSignalsForRules);

    // Risks
    const returnsDataForRules = [
      {
        productName: 'Global Store',
        returnRate: currReturnRate,
        previousReturnRate: prevReturnRate,
        sampleSize: currReturns.totalOrders
      }
    ];
    
    const paymentDataForRules = {
      codRtoRate: currCodRto,
      codSampleSize: currPayments.codOrders
    };

    const risks = detectRisks(returnsDataForRules, paymentDataForRules);

    return {
      summary: {
        demand: {
          value: currOrders,
          change: demandGrowth,
          period: period.comparisonLabel,
          sampleSize: currOrders,
          confidence: evaluateConfidence(currOrders, RULES.MIN_SAMPLE_SIZE.ORDERS)
        },
        sentiment: {
          value: currRating.avg,
          change: sentimentChange,
          period: period.comparisonLabel,
          sampleSize: currRating.count,
          confidence: evaluateConfidence(currRating.count, RULES.MIN_SAMPLE_SIZE.REVIEWS)
        },
        returnRisk: {
          value: currReturnRate,
          change: currReturnRate - prevReturnRate,
          period: period.comparisonLabel,
          sampleSize: currReturns.totalOrders,
          confidence: evaluateConfidence(currReturns.totalOrders, RULES.MIN_SAMPLE_SIZE.ORDERS)
        }
      },
      opportunities,
      risks,
      emergingTrends: [] // To be expanded with specific trend queries
    };
  });
};

// 2. CUSTOMER / PRODUCT (Customer Signals, Segments, Sentiment, Product Demand)
export const getCustomerProductIntelligence = async (range, customStartDate, customEndDate) => {
  const period = resolvePeriod(range, customStartDate, customEndDate);
  const cacheKey = `intel:custprod:${range}:${period.current.start.getTime()}:${period.current.end.getTime()}`;

  return getCachedOrFetch(cacheKey, TTLS.CUSTOMER_PRODUCT, async () => {
    // Normally you would have dedicated complex queries here
    const [currRating, productSignals, productsWithStock] = await Promise.all([
      getAverageRating(period.current.start, period.current.end),
      getProductSignals(period.current.start, period.current.end),
      getProductsWithStock()
    ]);

    const productDemand = productsWithStock.map(p => {
      const salesObj = productSignals.sales.find(s => s.productId === p.id);
      const wishlistObj = productSignals.wishlists.find(w => w.productId === p.id);
      const salesCount = salesObj ? salesObj.sales : 0;
      const wishlistCount = wishlistObj ? wishlistObj.wishlists : 0;
      const conversion = wishlistCount > 0 ? (salesCount / wishlistCount) * 100 : 0;

      return {
        id: p.id,
        name: p.name,
        stock: p.stock,
        sales: salesCount,
        wishlists: wishlistCount,
        conversionRate: conversion
      };
    }).sort((a, b) => b.wishlists - a.wishlists).slice(0, 10);

    return {
      customerSignals: {
        // Mocking structure until full customer repo queries are written
        newCustomers: { value: 0, change: 0 },
        returningCustomers: { value: 0, change: 0 }
      },
      segments: [],
      sentiment: {
        average: currRating.avg,
        reviewsCount: currRating.count,
      },
      productDemand,
      inventoryPressure: productDemand.filter(p => p.stock < RULES.THRESHOLDS.LOW_STOCK_UNITS && p.wishlists > 10)
    };
  });
};

// 3. MARKET (Geography, Payment, Journey, Returns)
export const getMarketIntelligence = async (range, customStartDate, customEndDate) => {
  const period = resolvePeriod(range, customStartDate, customEndDate);
  const cacheKey = `intel:market:${range}:${period.current.start.getTime()}:${period.current.end.getTime()}`;

  return getCachedOrFetch(cacheKey, TTLS.MARKET, async () => {
    const [currReturns, prevReturns, currPayments] = await Promise.all([
      getReturnStats(period.current.start, period.current.end),
      getReturnStats(period.previous.start, period.previous.end),
      getPaymentStats(period.current.start, period.current.end)
    ]);

    const currReturnRate = currReturns.totalOrders > 0 ? (currReturns.totalReturns / currReturns.totalOrders) * 100 : 0;
    const prevReturnRate = prevReturns.totalOrders > 0 ? (prevReturns.totalReturns / prevReturns.totalOrders) * 100 : 0;

    return {
      geography: [], // To be implemented with detailed queries
      payment: {
        online: {
          orders: currPayments.onlineOrders,
          failedOrders: currPayments.onlineFailed,
          failureRate: currPayments.onlineOrders > 0 ? (currPayments.onlineFailed / currPayments.onlineOrders) * 100 : 0
        },
        cod: {
          orders: currPayments.codOrders,
          rtoOrders: currPayments.codRto,
          rtoRate: currPayments.codOrders > 0 ? (currPayments.codRto / currPayments.codOrders) * 100 : 0
        }
      },
      journey: [],
      returns: {
        rate: {
          value: currReturnRate,
          change: currReturnRate - prevReturnRate,
          sampleSize: currReturns.totalOrders,
          confidence: evaluateConfidence(currReturns.totalOrders, RULES.MIN_SAMPLE_SIZE.ORDERS)
        }
      }
    };
  });
};

export const invalidateIntelligenceCache = async () => {
  // Use prefix invalidation to clear all intelligence cache keys
  await invalidateCache('intel:overview:', true);
  await invalidateCache('intel:custprod:', true);
  await invalidateCache('intel:market:', true);
};
