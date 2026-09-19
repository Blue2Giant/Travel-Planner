import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileSlug } from '../xiaohongshu/guide.js';
import { createAdapters } from './adapters.js';
import { createTravelPlan } from './planner.js';
import { parseTravelRequest } from './requirements.js';
import { renderTravelPlan } from './report.js';

const ROOT = path.resolve(process.cwd());
async function writeJson(file, value) { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, JSON.stringify(value, null, 2)); }

export async function buildTravelPlan(input, { adapters = createAdapters() } = {}) { return createTravelPlan(parseTravelRequest(input), adapters); }

export async function generateTravelPlan(input, options = {}) {
  const plan = await createTravelPlan(parseTravelRequest(input), options.adapters || createAdapters());
  const slug = `${fileSlug(plan.trip.destination)}-${plan.trip.start_date}-${plan.trip.end_date}`;
  const requestFile = path.join(ROOT, 'data/raw/travel-plans', `${slug}-request.json`);
  const planFile = path.join(ROOT, 'data/processed/travel-plans', `${slug}.json`);
  const validationFile = path.join(ROOT, 'data/processed/travel-plans', `${slug}-validation.json`);
  const htmlFile = path.join(ROOT, 'output', `${slug}.html`);
  await writeJson(requestFile, input); await writeJson(planFile, plan); await writeJson(validationFile, plan.validation);
  await mkdir(path.dirname(htmlFile), { recursive: true });
  await writeFile(htmlFile, renderTravelPlan(plan, { amapJsKey: process.env.AMAP_JSAPI_KEY || '', securityJsCode: process.env.AMAP_JSAPI_SECURITY_CODE || '' }));
  return { plan, requestFile, planFile, validationFile, htmlFile };
}
