const state = { map: null, amap: null, overlays: [], transitOverlays: [], data: null, selected: 'driving', focusedSegment: null };
const $ = (selector) => document.querySelector(selector);
const fmtDistance = (value = 0) => value < 1000 ? `${Math.round(value)} m` : `${(value / 1000).toFixed(1)} km`;
const fmtDuration = (value) => { const seconds = Number(value); if (!Number.isFinite(seconds) || seconds <= 0) return '—'; if (seconds < 60) return '< 1 min'; const min = Math.round(seconds / 60); return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60 ? `${min % 60} min` : ''}`.trim(); };
const escape = (text = '') => String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]));

async function loadMap() {
  const config = await fetch('/api/config').then((r) => r.json());
  if (!config.amapJsKey) { $('#map').innerHTML = '<div class="map-placeholder">地图需要在 <code>.env</code> 填写 AMAP_JSAPI_KEY。</div>'; return; }
  if (config.securityJsCode) window._AMapSecurityConfig = { securityJsCode: config.securityJsCode };
  await new Promise((resolve, reject) => {
    const script = document.createElement('script'); script.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(config.amapJsKey)}`;
    script.onload = resolve; script.onerror = reject; document.head.append(script);
  }).catch(() => { $('#map').innerHTML = '<div class="map-placeholder">高德地图加载失败，请检查 JSAPI Key 与网络。</div>'; });
  if (!window.AMap) return;
  state.amap = window.AMap; state.map = new AMap.Map('map', { zoom: 11, center: [121.47, 31.23], viewMode: '2D' });
}
function clearTransitOverlays() { if (state.map && state.transitOverlays.length) state.map.remove(state.transitOverlays); state.transitOverlays = []; }
function clearMap() { if (state.map && state.overlays.length) state.map.remove(state.overlays); state.overlays = []; state.transitOverlays = []; }
function marker(position, label, className) { return new state.amap.Marker({ position, content: `<span class="marker ${className}">${label}</span>`, offset: new state.amap.Pixel(-14, -14), zIndex: 200 }); }
function addMarker(position, label, className) { const item = marker(position, label, className); state.map.add(item); state.overlays.push(item); }

const SHANGHAI_METRO_COLORS = { '1号线': '#E53935', '2号线': '#65B32E', '3号线': '#F4C430', '4号线': '#6A3D9A', '5号线': '#A93226', '6号线': '#D81B60', '7号线': '#F57C00', '8号线': '#1565C0', '9号线': '#7B1FA2', '10号线': '#8E7CC3', '11号线': '#8E24AA', '12号线': '#00897B', '13号线': '#E67E22', '14号线': '#5E35B1', '15号线': '#9575CD', '16号线': '#7CB342', '17号线': '#00ACC1', '18号线': '#795548' };
const METRO_FALLBACK_COLORS = ['#2563EB', '#DC2626', '#16A34A', '#9333EA', '#EA580C', '#0891B2', '#DB2777', '#4F46E5'];
const BUS_COLORS = ['#F97316', '#0D9488', '#0284C7', '#65A30D', '#C026D3', '#EA580C'];
function stableColor(name, palette) { let hash = 0; for (const char of String(name)) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0; return palette[Math.abs(hash) % palette.length]; }
function metroColor(name) { return Object.entries(SHANGHAI_METRO_COLORS).find(([line]) => String(name).includes(line))?.[1] || stableColor(name, METRO_FALLBACK_COLORS); }
function normalizeLngLat(point) {
  if (!point) return null;
  if (typeof point.getLng === 'function' && typeof point.getLat === 'function') return point;
  const parts = Array.isArray(point) ? point : typeof point === 'string' ? point.split(',') : [point.lng, point.lat];
  const lng = Number(parts[0]); const lat = Number(parts[1]);
  return Number.isFinite(lng) && Number.isFinite(lat) ? new state.amap.LngLat(lng, lat) : null;
}
function dedupePath(points) { let last = ''; return points.filter(Boolean).filter((point) => { const key = `${point.getLng().toFixed(6)},${point.getLat().toFixed(6)}`; if (key === last) return false; last = key; return true; }); }
function extractPath(source) {
  if (!source) return [];
  const input = Array.isArray(source) ? source : Array.isArray(source.path) ? source.path : typeof source.polyline === 'string' ? source.polyline.split(';') : Array.isArray(source.polyline) ? source.polyline : [];
  return dedupePath(input.map(normalizeLngLat));
}
function extractWalkingPath(segment) { return dedupePath([...(segment.steps || []).flatMap((step) => extractPath(step)), ...extractPath(segment)]); }
function createStrongPolyline(path, { color, width, dashed = false, zIndex, showDir = false }) {
  if (path.length < 2) return [];
  const common = { path, strokeStyle: dashed ? 'dashed' : 'solid', lineJoin: 'round', lineCap: 'round' };
  const halo = new state.amap.Polyline({ ...common, strokeColor: '#FFFFFF', strokeOpacity: .98, strokeWeight: width + 7, zIndex });
  const line = new state.amap.Polyline({ ...common, strokeColor: color, strokeOpacity: 1, strokeWeight: width, strokeDasharray: dashed ? [12, 8] : undefined, showDir, zIndex: zIndex + 1 });
  return [halo, line];
}
function addTransferMarker(position) {
  const center = normalizeLngLat(position); if (!center) return;
  const marker = new state.amap.CircleMarker({ center, radius: 7, fillColor: '#FFFFFF', fillOpacity: 1, strokeColor: '#334155', strokeWeight: 3, zIndex: 170 });
  state.map.add(marker); state.overlays.push(marker); state.transitOverlays.push(marker);
}
function renderTransitRoute(route) {
  clearTransitOverlays();
  const overlays = []; let previousTransit = null;
  route.segments.forEach((segment, index) => {
    const path = segment.type === 'walk' ? extractWalkingPath(segment) : extractPath(segment);
    if (path.length < 2) { console.warn('[Transit] invalid geometry', { name: segment.lineName, type: segment.type, points: path.length }); return; }
    const style = segment.type === 'walk' ? { color: '#64748B', width: 7, dashed: true, zIndex: 120, showDir: true }
      : segment.type === 'subway' ? { color: metroColor(segment.lineName), width: 11, zIndex: 140 }
        : segment.type === 'railway' ? { color: '#0891B2', width: 10, zIndex: 135 }
          : segment.type === 'taxi' ? { color: '#D97706', width: 8, zIndex: 130 }
            : { color: stableColor(segment.lineName, BUS_COLORS), width: 8, zIndex: 130 };
    const items = createStrongPolyline(path, style); overlays.push(...items);
    if (previousTransit && segment.type !== 'walk') addTransferMarker(segment.fromLocation || path[0]);
    if (segment.type !== 'walk') previousTransit = segment;
    console.debug('[Transit] line', { name: segment.lineName, type: segment.type, points: path.length });
  });
  if (!overlays.length) { console.warn('[Transit] no drawable route overlays', route.segments); return; }
  state.map.add(overlays); state.overlays.push(...overlays); state.transitOverlays = overlays;
  requestAnimationFrame(() => state.map.setFitView([...overlays, ...state.overlays.filter((item) => !overlays.includes(item))], false, [70, 70, 70, 70]));
}
function drawRoute() {
  if (!state.map || !state.data) return;
  clearMap(); const { origin, destination } = state.data; addMarker([origin.lng, origin.lat], 'A', 'start'); addMarker([destination.lng, destination.lat], 'B', 'end');
  const route = state.data[state.selected]; if (!route) return;
  const addDrivingLine = (path) => {
    const points = extractPath(path); if (points.length < 2) return;
    const line = new state.amap.Polyline({ path: points, strokeColor: '#2563EB', strokeOpacity: .96, strokeWeight: 10, lineJoin: 'round', lineCap: 'round', zIndex: 120, showDir: true });
    state.map.add(line); state.overlays.push(line); state.map.setFitView(state.overlays, false, [70, 70, 70, 70]);
  };
  if (state.selected === 'driving') { $('#map-legend').classList.add('hidden'); state.map.setMapStyle('amap://styles/normal'); addDrivingLine(route.polyline); }
  else {
    state.map.setMapStyle('amap://styles/whitesmoke');
    $('#map-legend').classList.remove('hidden');
    $('#map-legend').innerHTML = '<span class="legend walk">步行</span><span class="legend subway">轨道交通（按线路着色）</span><span class="legend bus">公交</span><span class="legend railway">铁路/高铁</span><span class="legend taxi">出租车</span>';
    console.debug('[Transit] plan segments', route.segments);
    renderTransitRoute(route);
  }
}
function render() {
  const { origin, destination, driving, transit, warnings = [] } = state.data;
  $('#places').classList.remove('hidden'); $('#places').innerHTML = `<div><small>已识别起点</small><strong>${escape(origin.name)}</strong><span>${escape(origin.address)}</span></div><div><small>已识别终点</small><strong>${escape(destination.name)}</strong><span>${escape(destination.address)}</span></div>`;
  $('#modes').classList.remove('hidden'); $('#modes').innerHTML = [['driving', '🚗', '驾车', driving], ['transit', '🚇', '公共交通', transit]].map(([id, icon, label, route]) => `<button class="mode ${state.selected === id ? 'active' : ''}" data-mode="${id}" ${route ? '' : 'disabled'}><span>${icon} ${label}</span>${route ? `<strong>${fmtDistance(route.distanceMeters)}</strong><small>${fmtDuration(route.durationSeconds)}</small>` : '<small>暂无可用路线</small>'}</button>`).join('');
  document.querySelectorAll('[data-mode]').forEach((button) => button.onclick = () => { state.selected = button.dataset.mode; state.focusedSegment = null; render(); drawRoute(); });
  const route = state.data[state.selected];
  $('#details').innerHTML = route ? state.selected === 'driving' ? drivingDetails(route) : transitDetails(route) : '<p class="empty">该交通方式暂无可用路线。</p>';
  document.querySelectorAll('[data-segment]').forEach((item) => item.onclick = (event) => {
    if (event.target.closest('details')) return;
    state.focusedSegment = Number(item.dataset.segment); render(); drawRoute();
  });
  $('#status').textContent = warnings.length ? `已返回可用路线；${warnings.join('；')}` : '路线已更新。';
}
function drivingDetails(route) { const roads = route.steps.filter((step) => step.roadName).filter((step, i, all) => i === 0 || step.roadName !== all[i - 1].roadName); return `<div class="detail-title"><div><p class="eyebrow">ROUTE DETAILS</p><h2>🚗 驾车</h2></div><p><b>${fmtDistance(route.distanceMeters)}</b><span>${fmtDuration(route.durationSeconds)}</span></p></div><h3>主要道路</h3><ol class="road-list">${roads.slice(0, 7).map((step) => `<li>${escape(step.roadName)} <small>${fmtDistance(step.distanceMeters)}</small></li>`).join('') || '<li>高德未提供道路明细。</li>'}</ol><details><summary>查看完整导航步骤</summary>${route.steps.map((s) => `<p class="step">${escape(s.instruction)} <small>${fmtDistance(s.distanceMeters)}</small></p>`).join('')}</details>`; }
function transitDetails(route) {
  const icon = { walk: '🚶', subway: 'Ⓜ', bus: '🚌', railway: '🚄', taxi: '🚕' };
  const fare = Number(route.fare);
  return `<div class="detail-title"><div><p class="eyebrow">ROUTE DETAILS</p><h2>🚇 综合公共交通</h2></div><p><b>${fmtDistance(route.distanceMeters)}</b><span>${fmtDuration(route.durationSeconds)}${Number.isFinite(fare) && fare > 0 ? ` · ¥${fare}` : ''}</span></p></div><div class="transit-list">${route.segments.map((s, i) => {
    const stops = s.viaNum ? ` · 途经 ${s.viaNum} 站` : '';
    const viaNames = s.viaStops?.length ? `<details class="via"><summary>查看中间站</summary><p>${s.viaStops.map((stop) => escape(stop.name || stop)).join(' · ')}</p></details>` : '';
    const walkingSteps = s.type === 'walk' && s.steps?.length ? `<details class="walk-steps"><summary>查看步行路线</summary>${s.steps.map((step) => `<p>${escape(step.instruction)} <small>${fmtDistance(step.distanceMeters)} · ${fmtDuration(step.durationSeconds)}</small></p>`).join('')}</details>` : '';
    return `<article class="transit-segment ${state.focusedSegment === i ? 'focused' : ''}" data-segment="${i}"><i>${i + 1}</i><div><b>${icon[s.type] || '•'} ${escape(s.lineName || s.type)}</b>${s.lineType ? `<span class="line-type">${escape(s.lineType)}</span>` : ''}${s.from || s.to ? `<p>${escape(s.from || '起点')} <em>→</em> ${escape(s.to || '终点')}</p>` : ''}<small>${fmtDistance(s.distanceMeters)} · ${fmtDuration(s.durationSeconds)}${stops}</small>${viaNames}${walkingSteps}</div></article>`;
  }).join('') || '<p class="empty">高德未提供分段详情。</p>'}</div>`;
}
$('#route-form').addEventListener('submit', async (event) => { event.preventDefault(); $('#submit').disabled = true; $('#status').textContent = '正在解析地点并查询真实路线…'; try { const response = await fetch('/api/routes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ origin: $('#origin').value, destination: $('#destination').value }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error || '查询失败'); state.data = data; state.selected = data.driving ? 'driving' : 'transit'; state.focusedSegment = null; render(); drawRoute(); } catch (error) { $('#status').textContent = `查询失败：${error.message}`; } finally { $('#submit').disabled = false; } });
$('#swap').onclick = () => { const origin = $('#origin'); const destination = $('#destination'); [origin.value, destination.value] = [destination.value, origin.value]; };
loadMap();
