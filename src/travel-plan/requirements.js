const DEFAULTS = Object.freeze({
  travelers: { adults: 1, children: 0 },
  preferences: { pace: 'moderate', budget: 'medium', hotel_level: 'comfortable', food_interest: true, photography: true, nature: true, culture: true, avoid_early_morning: true },
  constraints: { max_daily_attractions: 4, max_daily_commute_minutes: 180 }
});

function isoDate(year, month, day) {
  const value = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (value.getUTCFullYear() !== Number(year) || value.getUTCMonth() !== Number(month) - 1 || value.getUTCDate() !== Number(day)) throw new Error(`日期无效：${year}-${month}-${day}`);
  return value.toISOString().slice(0, 10);
}

function normalizeDate(value, fallbackYear) {
  const text = String(value || '').trim();
  const match = text.match(/^(?:(\d{4})[-/.])?(\d{1,2})[-/.](\d{1,2})/);
  if (!match) throw new Error(`无法识别日期：${value || '空值'}`);
  return isoDate(match[1] || fallbackYear, match[2], match[3]);
}

function destinations(value) {
  return (Array.isArray(value) ? value : String(value || '').split(/[、,，和及+&]/)).map((item) => String(item).trim()).filter(Boolean);
}

function fromText(text, year) {
  const dates = [...String(text).matchAll(/(?:(\d{4})[-/.年])?(\d{1,2})[-/.月](\d{1,2})/g)];
  const origin = String(text).match(/从\s*([^，,。\s]+?)\s*(?:出发|去|前往)/)?.[1] || '';
  const route = String(text).match(/(?:游玩|去|前往)\s*([^，,。]+?)(?:，|,|最后|并于|$)/)?.[1] || '';
  return { origin, destination: route.replace(/和|以及/g, '、'), start_date: dates[0] ? isoDate(dates[0][1] || year, dates[0][2], dates[0][3]) : '', end_date: dates[1] ? isoDate(dates[1][1] || dates[0]?.[1] || year, dates[1][2], dates[1][3]) : '' };
}

export function parseTravelRequest(input, { currentYear = new Date().getFullYear() } = {}) {
  const raw = typeof input === 'string' ? fromText(input, currentYear) : { ...(input || {}) };
  const origin = String(raw.origin || '').trim(); const places = destinations(raw.destinations || raw.destination);
  if (!origin) throw new Error('请提供出发地。');
  if (!places.length) throw new Error('请提供至少一个目的地。');
  const start = normalizeDate(raw.start_date || raw.startDate, currentYear);
  const end = normalizeDate(raw.end_date || raw.endDate, Number(start.slice(0, 4)));
  const nights = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000);
  if (nights < 1) throw new Error('结束日期必须晚于开始日期。');
  return { trip: { origin, destinations: places, destination: places.join(' · '), start_date: start, end_date: end, nights, days: nights + 1 }, travelers: { ...DEFAULTS.travelers, ...(raw.travelers || {}) }, preferences: { ...DEFAULTS.preferences, ...(raw.preferences || {}) }, constraints: { ...DEFAULTS.constraints, ...(raw.constraints || {}) }, assumptions: raw.assumptions || [] };
}

export function dateAdd(date, amount) { const value = new Date(`${date}T00:00:00Z`); value.setUTCDate(value.getUTCDate() + amount); return value.toISOString().slice(0, 10); }
export function formatDate(date) { const value = new Date(`${date}T00:00:00Z`); return `${value.getUTCMonth() + 1}月${value.getUTCDate()}日`; }
