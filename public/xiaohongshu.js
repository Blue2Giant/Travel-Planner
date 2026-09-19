const form = document.querySelector('#guide-form');
const destination = document.querySelector('#destination');
const generate = document.querySelector('#generate');
const result = document.querySelector('#result');
const planForm = document.querySelector('#travel-plan-form');
const generatePlan = document.querySelector('#generate-plan');
const escape = (value = '') => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const place = destination.value.trim();
  if (!place) return;
  generate.disabled = true; destination.disabled = true;
  result.innerHTML = '<p class="loading">正在检查登录、规划多组关键词、排序去重并读取 15–25 篇候选帖子。搜索过程可能需要几分钟…</p>';
  try {
    const response = await fetch('/api/xiaohongshu/guides', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ destination: place }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '生成失败。');
    result.innerHTML = `<p class="success">已完成：基于 ${data.posts} 篇帖子生成了「${escape(place)}」攻略。</p><a class="open" href="${escape(data.htmlUrl)}" target="_blank" rel="noopener noreferrer">打开攻略 HTML →</a>`;
  } catch (error) {
    result.innerHTML = `<p class="error">生成失败：${escape(error.message)}</p><p>请确认小红书 MCP 正在运行且已登录；稍后可直接再次点击生成。</p>`;
  } finally { generate.disabled = false; destination.disabled = false; }
});

async function createTravelPlan() {
  const payload = {
    origin: document.querySelector('#plan-origin').value.trim(),
    destination: document.querySelector('#plan-destination').value.split(/[、,，]/).map((item) => item.trim()).filter(Boolean),
    start_date: document.querySelector('#plan-start').value,
    end_date: document.querySelector('#plan-end').value,
    preferences: { pace: 'relaxed', photography: true, nature: true, culture: true }
  };
  if (!payload.destination.length || !payload.start_date || !payload.end_date) throw new Error('请填写目的地和日期。');
  const response = await fetch('/api/travel-plans', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '规划生成失败。');
  return data;
}

planForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  generatePlan.disabled = true;
  result.innerHTML = '<p class="loading">正在串联小红书、携程和高德路线数据；实时模式可能需要几分钟…</p>';
  try {
    const data = await createTravelPlan();
    result.innerHTML = `<p class="success">完整路线规划已生成：${escape(data.trip.destination)}，每天包含独立路线图。</p><a class="open" href="${escape(data.htmlUrl)}" target="_blank" rel="noopener noreferrer">打开完整规划 HTML →</a>`;
  } catch (error) { result.innerHTML = `<p class="error">规划生成失败：${escape(error.message)}</p>`; }
  finally { generatePlan.disabled = false; }
});
