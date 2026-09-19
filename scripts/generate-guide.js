#!/usr/bin/env node
import { generateGuide } from '../src/xiaohongshu/guide.js';
import { writeDemoPosts } from '../src/xiaohongshu/demo.js';

const destination = process.argv.slice(2).find((argument) => !argument.startsWith('--')) || process.env.DESTINATION;
const demo = process.argv.includes('--demo');
if (!destination) { console.error('用法：npm run guide -- 京都 [--demo]，或 npm run guide:demo -- 京都'); process.exit(1); }
if (demo) await writeDemoPosts(destination);
try { console.log(JSON.stringify(await generateGuide(destination, { demo }), null, 2)); }
catch (error) { console.error(error.message); process.exit(1); }
