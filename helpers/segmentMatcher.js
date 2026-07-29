// ✅ file: helpers/segmentMatcher.js

/**
 * Evaluates if a user belongs to a specific targeting segment.
 * @param {Object} user - The user object from usersTable
 * @param {Array} orders - Array of the user's completed orders
 * @param {String} segment - The targetCategory string (e.g., 'vip', 'new_user')
 * @returns {Boolean}
 */
export const userMatchesSegment = (user, orders, segment) => {
    if (!segment || segment === 'all' || segment === '') return true;
  
    const safeOrders = Array.isArray(orders) ? orders : [];
    const orderCount = safeOrders.length;
    
    // Core metrics
    const totalSpent = safeOrders.reduce((sum, order) => sum + (order.totalAmount || 0), 0);
    const aov = orderCount > 0 ? totalSpent / orderCount : 0;
    
    // Dates
    const now = new Date();
    const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
    
    const lastOrderDate = orderCount > 0 
      ? new Date(Math.max(...safeOrders.map(o => new Date(o.createdAt).getTime()))) 
      : null;
      
    const joinDate = user?.createdAt ? new Date(user.createdAt) : now;
  
    switch (segment.toLowerCase()) {
        case 'new_user': return joinDate > thirtyDaysAgo;
        case 'vip': return totalSpent > 10000;
        case 'returning': return orderCount > 2;
        case 'inactive': return orderCount > 0 && lastOrderDate && lastOrderDate < sixtyDaysAgo;
        case 'one_time_buyer': return orderCount === 1;
        case 'big_spenders': return aov > 2000;
        case 'almost_vip': return totalSpent >= 7000 && totalSpent < 10000;
        case 'loyal_customers': return orderCount >= 10;
        case 'subscribers': return user?.notify_promos === true;
        case 'frequent_low_spender': return orderCount > 5 && totalSpent < 5000;
        case 'whale': return totalSpent > 50000;
        
        case 'coupon_hunter': 
            if (orderCount < 2) return false;
            // Now checks the new couponId relation instead of string matches
            const couponOrders = safeOrders.filter(o => o.couponId !== null).length;
            return (couponOrders / orderCount) >= 0.75;
            
        case 'churn_risk':
            if (!lastOrderDate || orderCount < 3) return false;
            const daysSince = Math.ceil(Math.abs(now - lastOrderDate) / (1000 * 60 * 60 * 24));
            return daysSince > 45 && daysSince <= 90;
            
        case 'trending_user':
            return safeOrders.filter(o => new Date(o.createdAt) > twoWeeksAgo).length >= 2;
            
        case 'anniversary_month':
            return joinDate.getMonth() === now.getMonth() && joinDate.getFullYear() < now.getFullYear();
            
        case 'weekend_shopper':
            if (orderCount < 2) return false;
            const weekends = safeOrders.filter(o => {
                const d = new Date(o.createdAt).getDay();
                return d === 0 || d === 6; 
            }).length;
            return (weekends / orderCount) > 0.6;
            
        default: 
            return false; 
    }
  };