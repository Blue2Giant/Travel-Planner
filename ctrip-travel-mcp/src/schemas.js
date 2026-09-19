import { z } from 'zod';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期必须是 YYYY-MM-DD。');
const limit = z.number().int().min(1).max(20).optional().default(10);
export const flightShape = { origin: z.string().trim().min(1), destination: z.string().trim().min(1), date, limit, max_price: z.number().positive().optional(), sort_by: z.enum(['price']).optional() };
export const roundtripShape = { origin: z.string().trim().min(1), destination: z.string().trim().min(1), depart_date: date, return_date: date, limit };
export const trainShape = { origin: z.string().trim().min(1), destination: z.string().trim().min(1), date, train_types: z.array(z.enum(['G', 'D', 'C', 'Z', 'T', 'K'])).max(6).optional(), limit: z.number().int().min(1).max(20).optional().default(20) };
export const hotelShape = { city: z.string().trim().min(1), checkin: date, checkout: date, keyword: z.string().trim().max(80).optional(), min_star: z.number().min(1).max(5).optional(), min_score: z.number().min(0).max(5).optional(), max_price: z.number().positive().optional(), limit };
export const hotelDetailShape = { hotel_id: z.string().trim().min(1).max(40) };
export const hotelCityShape = { city: z.string().trim().min(1).max(80) };
