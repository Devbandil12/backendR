import { CONFIDENCE_LEVELS } from './intelligence.constants.js';

export const RULES = {
  MIN_SAMPLE_SIZE: {
    ORDERS: 20,
    WISHLIST: 50,
    REVIEWS: 10
  },
  THRESHOLDS: {
    HIGH_DEMAND_GROWTH_PCT: 20, // 20% growth
    LOW_STOCK_UNITS: 10,
    RETURN_SPIKE_PCT_PTS: 5, // 5 percentage points
    RTO_RISK_PCT: 10 // 10% RTO rate
  }
};

export const evaluateConfidence = (sampleSize, minRequired) => {
  if (sampleSize >= minRequired * 3) return CONFIDENCE_LEVELS.HIGH;
  if (sampleSize >= minRequired) return CONFIDENCE_LEVELS.MEDIUM;
  return CONFIDENCE_LEVELS.LOW;
};

export const detectOpportunities = (productSignals) => {
  const opportunities = [];
  productSignals.forEach(signal => {
    // High Demand + Low Stock
    if (
      signal.demandGrowthPct > RULES.THRESHOLDS.HIGH_DEMAND_GROWTH_PCT &&
      signal.stock <= RULES.THRESHOLDS.LOW_STOCK_UNITS
    ) {
      opportunities.push({
        type: 'HIGH_DEMAND_LOW_STOCK',
        title: `Restock ${signal.productName}`,
        description: `Demand is rising (${signal.demandGrowthPct.toFixed(1)}%) while stock is very low (${signal.stock} units left).`,
        actionUrl: `/admin?tab=products&filter=low-stock&search=${encodeURIComponent(signal.productName)}`,
        actionLabel: 'Restock Product',
        confidence: evaluateConfidence(signal.demandSampleSize, RULES.MIN_SAMPLE_SIZE.WISHLIST)
      });
    }
  });
  return opportunities;
};

export const detectRisks = (returnsData, paymentData) => {
  const risks = [];
  
  // Return Spike
  returnsData.forEach(item => {
    if (item.returnRate - item.previousReturnRate > RULES.THRESHOLDS.RETURN_SPIKE_PCT_PTS) {
      risks.push({
        type: 'RETURN_SPIKE',
        title: `Investigate ${item.productName} Returns`,
        description: `Return rate increased by ${(item.returnRate - item.previousReturnRate).toFixed(1)} percentage points to ${item.returnRate.toFixed(1)}%.`,
        actionUrl: `/admin?tab=orders&filter=returned&search=${encodeURIComponent(item.productName)}`,
        actionLabel: 'View Returns',
        confidence: evaluateConfidence(item.sampleSize, RULES.MIN_SAMPLE_SIZE.ORDERS)
      });
    }
  });

  // COD RTO Risk
  if (paymentData.codRtoRate > RULES.THRESHOLDS.RTO_RISK_PCT) {
    risks.push({
      type: 'HIGH_RTO_RATE',
      title: 'Review COD Performance',
      description: `COD Return-to-Origin rate is unusually high at ${paymentData.codRtoRate.toFixed(1)}%.`,
      actionUrl: `/admin?tab=orders&filter=rto`,
      actionLabel: 'View RTO Orders',
      confidence: evaluateConfidence(paymentData.codSampleSize, RULES.MIN_SAMPLE_SIZE.ORDERS)
    });
  }

  return risks;
};
