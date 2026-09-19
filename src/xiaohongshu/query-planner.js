const MONTH_SEASONS = new Map([
  [1, '冬季'], [2, '冬季'], [3, '春季'], [4, '春季'], [5, '春季'],
  [6, '夏季'], [7, '夏季'], [8, '夏季'], [9, '秋季'], [10, '秋季'],
  [11, '秋季'], [12, '冬季']
]);

export function planQueries(destination, { days, month, season } = {}) {
  const place = String(destination || '').trim();
  if (!place) throw new Error('请提供目的地。');
  const tripLength = Number.isInteger(days) && days >= 2 && days <= 5 ? `${days}日游` : '3日游';
  const planned = [
    { kind: 'overview', keyword: `${place} 攻略` },
    { kind: 'attraction', keyword: `${place} 景点 推荐` },
    { kind: 'must_visit', keyword: `${place} 必去 景点` },
    { kind: 'itinerary', keyword: `${place} ${tripLength}` },
    { kind: 'route', keyword: `${place} 路线` },
    { kind: 'food', keyword: `${place} 美食` },
    { kind: 'stay', keyword: `${place} 住宿 区域` },
    { kind: 'pitfall', keyword: `${place} 避坑` },
    { kind: 'tips', keyword: `${place} 注意事项` }
  ];
  const seasonName = String(season || MONTH_SEASONS.get(Number(month)) || '').trim();
  if (seasonName) planned.push({ kind: 'season', keyword: `${place} ${seasonName}` });
  return planned;
}

export function planRouteMapQueries(attraction) {
  const name = String(attraction || '').trim();
  if (!name) return [];
  return ['路线图', '游览路线', '景区地图', '徒步路线'].map((term, index) => ({
    kind: `route_map_${index + 1}`,
    keyword: `${name} ${term}`,
    attraction: name
  }));
}
