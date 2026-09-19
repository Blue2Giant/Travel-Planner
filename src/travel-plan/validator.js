export function validateTravelPlan(plan) {
  const errors = []; const warnings = [...(plan.metadata.warnings || [])];
  let complete = true;
  if (plan.days.length !== plan.trip.days) errors.push(`应有 ${plan.trip.days} 天，实际生成 ${plan.days.length} 天。`);
  for (const day of plan.days) {
    if (!day.timeline.length) errors.push(`Day ${day.day} 没有时间轴。`);
    if (!day.map?.points?.length) errors.push(`Day ${day.day} 没有地图点位。`);
    if (day.route_legs.some((leg) => leg.provider !== 'amap' || !leg.polyline?.length)) { complete = false; warnings.push(`Day ${day.day} 存在未获得高德 geometry 的通勤段。`); }
    const commute = day.route_legs.reduce((sum, leg) => sum + (leg.duration_minutes || 0), 0);
    if (commute > plan.constraints.max_daily_commute_minutes) warnings.push(`Day ${day.day} 市内通勤约 ${commute} 分钟，超过用户约束。`);
  }
  if (!plan.hotel.stays.every((stay) => stay.recommended.length)) { complete = false; warnings.push('部分目的地未获得携程酒店候选。'); }
  if (plan.transport.outbound.recommended?.unavailable || plan.transport.return.recommended?.unavailable) { complete = false; warnings.push('去程或返程缺少可用的携程推荐。'); }
  if (!plan.attractions.every((item) => item.poi?.id)) errors.push('存在未经高德 POI 验证的核心景点。');
  if (!plan.source_posts.every((source) => source.url)) errors.push('存在缺少来源 URL 的小红书帖子。');
  return { valid: errors.length === 0, complete, checked_at: new Date().toISOString(), errors, warnings: [...new Set(warnings)] };
}
