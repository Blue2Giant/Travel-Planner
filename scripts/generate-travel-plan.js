#!/usr/bin/env node
import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { generateTravelPlan } from '../src/travel-plan/orchestrator.js';

const args = process.argv.slice(2);
const inputFile = args.find((argument) => argument.startsWith('--input='))?.slice('--input='.length);
const defaultInput = { origin: '北京', destination: ['香格里拉', '丽江'], start_date: '2026-10-02', end_date: '2026-10-07', travelers: { adults: 1 }, preferences: { pace: 'relaxed', photography: true, nature: true, culture: true } };
const value = (name) => args.find((argument) => argument.startsWith(`--${name}=`))?.slice(name.length + 3);
const inlineInput = {
  origin: value('origin'),
  destination: value('destinations')?.split(/[、,，]/).map((item) => item.trim()).filter(Boolean),
  start_date: value('start'),
  end_date: value('end'),
  label: value('label'),
  preferences: { pace: value('pace') || 'moderate', ...(value('outbound-period') ? { outbound_period: value('outbound-period') } : {}), ...(value('return-period') ? { return_period: value('return-period') } : {}) },
  constraints: {
    ...(value('max-attractions') ? { max_daily_attractions: Number(value('max-attractions')) } : {}),
    ...(value('max-commute') ? { max_daily_commute_minutes: Number(value('max-commute')) } : {})
  }
};
const hasInlineInput = inlineInput.origin || inlineInput.destination || inlineInput.start_date || inlineInput.end_date;
if (hasInlineInput && (!inlineInput.origin || !inlineInput.destination?.length || !inlineInput.start_date || !inlineInput.end_date)) {
  throw new Error('命令行输入必须同时包含 --origin、--destinations、--start 和 --end。');
}
const input = inputFile ? JSON.parse(await readFile(inputFile, 'utf8')) : hasInlineInput ? inlineInput : defaultInput;
const result = await generateTravelPlan(input);
console.log(JSON.stringify({ htmlFile: result.htmlFile, planFile: result.planFile, requestFile: result.requestFile, warnings: result.plan.metadata.warnings }, null, 2));
