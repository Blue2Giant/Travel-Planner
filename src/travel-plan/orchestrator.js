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

// 产物文件名默认只由「目的地 + 起止日期」决定，同一路线换个出发地或再跑一次就会
// 覆盖上一版 HTML（output/ 是提交进仓库的示例目录，覆盖即丢失）。传入 label 会把它
// 作为前缀，让「上海出发」这类变体各自留档，例如 上海-丽江-香格里拉-2026-10-02-2026-10-07.html。
export function planSlug(plan, label) {
  const prefix = label ? `${fileSlug(label)}-` : '';
  return `${prefix}${fileSlug(plan.trip.destination)}-${plan.trip.start_date}-${plan.trip.end_date}`;
}

export async function generateTravelPlan(input, options = {}) {
  const plan = await createTravelPlan(parseTravelRequest(input), options.adapters || createAdapters());
  const label = options.label || (typeof input === 'object' && input ? input.label : '');
  const slug = planSlug(plan, label);
  const requestFile = path.join(ROOT, 'data/raw/travel-plans', `${slug}-request.json`);
  const planFile = path.join(ROOT, 'data/processed/travel-plans', `${slug}.json`);
  const validationFile = path.join(ROOT, 'data/processed/travel-plans', `${slug}-validation.json`);
  const htmlFile = path.join(ROOT, 'output', `${slug}.html`);
  await writeJson(requestFile, input); await writeJson(planFile, plan); await writeJson(validationFile, plan.validation);
  await mkdir(path.dirname(htmlFile), { recursive: true });
  await writeFile(htmlFile, renderTravelPlan(plan, { amapJsKey: process.env.AMAP_JSAPI_KEY || '', securityJsCode: process.env.AMAP_JSAPI_SECURITY_CODE || '' }));
  return { plan, requestFile, planFile, validationFile, htmlFile };
}
