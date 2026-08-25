export const resolvePeriod = (range, customStartDate, customEndDate) => {
  const now = new Date();
  const current = { start: new Date(now), end: new Date(now) };
  const previous = { start: new Date(now), end: new Date(now) };
  let hasTrend = true;
  let comparisonLabel = '';

  switch (range) {
    case 'today':
    case 'day':
      current.start.setHours(0, 0, 0, 0);
      previous.start = new Date(now); previous.start.setDate(now.getDate() - 1); previous.start.setHours(0, 0, 0, 0);
      previous.end = new Date(now); previous.end.setDate(now.getDate() - 1); previous.end.setHours(23, 59, 59, 999);
      comparisonLabel = 'vs yesterday';
      break;
    case 'yesterday':
      current.start = new Date(now); current.start.setDate(now.getDate() - 1); current.start.setHours(0, 0, 0, 0);
      current.end = new Date(now); current.end.setDate(now.getDate() - 1); current.end.setHours(23, 59, 59, 999);
      previous.start = new Date(now); previous.start.setDate(now.getDate() - 2); previous.start.setHours(0, 0, 0, 0);
      previous.end = new Date(now); previous.end.setDate(now.getDate() - 2); previous.end.setHours(23, 59, 59, 999);
      comparisonLabel = 'vs day before yesterday';
      break;
    case 'week':
    case '7days':
      current.start.setDate(now.getDate() - 7);
      previous.start.setDate(now.getDate() - 14);
      previous.end.setDate(now.getDate() - 7);
      comparisonLabel = 'vs previous 7 days';
      break;
    case 'month':
    case '30days':
      current.start.setDate(now.getDate() - 30);
      previous.start.setDate(now.getDate() - 60);
      previous.end.setDate(now.getDate() - 30);
      comparisonLabel = 'vs previous 30 days';
      break;
    case '3months':
    case '90days':
      current.start.setDate(now.getDate() - 90);
      previous.start.setDate(now.getDate() - 180);
      previous.end.setDate(now.getDate() - 90);
      comparisonLabel = 'vs previous 90 days';
      break;
    case '6months':
      current.start.setMonth(now.getMonth() - 6);
      previous.start.setMonth(now.getMonth() - 12);
      previous.end.setMonth(now.getMonth() - 6);
      comparisonLabel = 'vs previous 6 months';
      break;
    case 'year':
      current.start.setFullYear(now.getFullYear() - 1);
      previous.start.setFullYear(now.getFullYear() - 2);
      previous.end.setFullYear(now.getFullYear() - 1);
      comparisonLabel = 'vs previous year';
      break;
    case 'all':
      current.start = new Date('2020-01-01');
      hasTrend = false;
      comparisonLabel = 'All Time';
      break;
    case 'custom':
      current.start = new Date(customStartDate);
      current.end = new Date(customEndDate);
      const diff = current.end.getTime() - current.start.getTime();
      previous.start = new Date(current.start.getTime() - diff);
      previous.end = new Date(current.end.getTime() - diff);
      comparisonLabel = 'vs previous equivalent period';
      break;
    default:
      // Default to 30 days
      current.start.setDate(now.getDate() - 30);
      previous.start.setDate(now.getDate() - 60);
      previous.end.setDate(now.getDate() - 30);
      comparisonLabel = 'vs previous 30 days';
      break;
  }

  return { current, previous, hasTrend, comparisonLabel };
};
