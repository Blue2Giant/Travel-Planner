# 高德地图公共交通路线可视化增强修复任务

## 1. 任务背景

当前项目已经实现：

- 驾车路线查询与地图渲染
- 公共交通路线查询与地图渲染
- 起点 / 终点 Marker
- 驾车 / 公共交通模式切换

目前存在一个明显 UI 问题：

### 驾车路线

驾车路线使用粗蓝色路线显示，路线非常清晰，可以一眼看出：

- 起点
- 终点
- 具体道路走向
- 整条路线

### 公共交通路线

公共交通路线虽然已经显示在地图上，但是：

- 路线过细
- 与高德地图本身的地铁线 / 道路线混在一起
- 步行、地铁、公交之间区分不明显
- 不同地铁线路之间区分不明显
- 换乘节点不明显
- 用户无法一眼看出“这条推荐路线到底怎么走”

因此需要重写公共交通路线在地图上的渲染方式。

---

## 2. 最终目标

公共交通路线需要达到类似驾车路线的视觉清晰度。

例如：

```text
A 起点
│
│ · · · · ·  步行
│
● 地铁站
━━━━━━━━━━━━ 地铁 2 号线
● 换乘站
━━━━━━━━━━━━ 地铁 11 号线
● 下车站
│
│ · · · · ·  步行
│
B 终点
```

要求地图上能够非常明显地区分：

- 步行
- 地铁
- 公交
- 铁路 / 高铁（如果搜索结果存在）
- 不同地铁线路
- 换乘站
- 起点
- 终点

---

## 3. 核心修复原则

### 禁止继续依赖 `AMap.Transfer` 默认地图绘制

当前问题很可能来自类似：

```js
new AMap.Transfer({
  map,
  city,
  panel
});
```

当把 `map` 传入 `AMap.Transfer` 时，高德会自己绘制公共交通路线。

这样虽然方便，但是：

- 默认线条较细
- 默认样式很难控制
- 很容易和高德底图自身线路混在一起
- CSS 无法可靠修改 Canvas / Overlay 中的线路

因此：

> `AMap.Transfer` 以后只负责“查询路线”，不再负责“绘制路线”。

公共交通路线必须：

```text
AMap.Transfer
       │
       ▼
获得搜索结果
       │
       ▼
读取 plan.segments
       │
       ├── walking
       ├── subway
       ├── bus
       └── railway
       │
       ▼
自行创建 AMap.Polyline
       │
       ▼
绘制在地图
```

---

## 4. 修改原则

请先检查现有项目代码，找到：

```text
AMap.Transfer
AMap.Driving
public transit
transit
route
map
Polyline
```

相关代码。

不要大规模重构项目。

优先：

1. 保留现有驾车逻辑
2. 保留现有公共交通 API 查询逻辑
3. 只替换“公共交通地图路线渲染层”
4. 保留当前 UI、路线卡片和切换逻辑
5. 不修改无关代码

---

## 5. 修改 Transfer 初始化方式

### 原来的模式

如果存在：

```js
const transfer = new AMap.Transfer({
  map: mapInstance,
  city,
  panel: panelId
});
```

修改为：

```js
const transfer = new AMap.Transfer({
  city,
  panel: panelId,
  hideMarkers: true
});
```

注意：

```js
map: mapInstance
```

必须删除。

原因：

我们不再让 `AMap.Transfer` 自己画路线。

---

## 6. 新增公共交通 Overlay 管理

新增：

```js
let transitOverlays = [];
```

如果当前代码是 React，则应该使用：

```ts
const transitOverlaysRef = useRef<any[]>([]);
```

或者项目现有的 overlay 管理方式。

新增统一清理函数：

```js
function clearTransitOverlays(map) {
  if (!map) return;

  if (transitOverlays.length > 0) {
    map.remove(transitOverlays);
    transitOverlays = [];
  }
}
```

React 版本：

```ts
function clearTransitOverlays(map: any) {
  if (!map) return;

  const overlays = transitOverlaysRef.current;

  if (overlays.length > 0) {
    map.remove(overlays);
    transitOverlaysRef.current = [];
  }
}
```

每次：

- 切换路线
- 重新搜索
- 从公共交通切换到驾车
- component unmount

都需要清除之前的 overlays。

---

## 7. 不要只依赖 `isOutline`

为了保证路线真正明显，建议使用：

### 双层 Polyline

每一段线路绘制两条线：

```text
底层：
白色粗线
strokeWeight = 16

上层：
真正线路颜色
strokeWeight = 10
```

视觉效果：

```text
██████████████   ← 白色 halo
  ██████████     ← 彩色线路
```

这比单纯：

```js
isOutline: true
```

更可靠。

因为不同高德 JS API 版本 / 渲染环境下 outline 表现可能不同。

---

## 8. 新增统一绘制函数

建议创建：

```text
src/utils/transitRenderer.ts
```

或者放入现有地图工具目录。

核心 API：

```ts
renderTransitPlan(map, plan)
```

结构：

```ts
function renderTransitPlan(map, plan) {
  clearTransitOverlays(map);

  const overlays = [];
  const bounds = [];

  for (const segment of plan.segments ?? []) {
    renderWalking(...);
    renderBusOrSubway(...);
    renderRailway(...);
  }

  map.add(overlays);
  map.setFitView(...);
}
```

---

## 9. 通用双层线路绘制函数

实现：

```js
function createStrongPolyline({
  map,
  path,
  color,
  width = 10,
  dashed = false,
  zIndex = 120,
  showDir = false
}) {
  if (!path || path.length < 2) {
    return [];
  }

  // 下面的白色 halo
  const halo = new AMap.Polyline({
    path,
    strokeColor: '#FFFFFF',
    strokeOpacity: 0.98,
    strokeWeight: width + 7,
    strokeStyle: dashed ? 'dashed' : 'solid',
    lineJoin: 'round',
    lineCap: 'round',
    zIndex: zIndex
  });

  // 上面的真实线路
  const line = new AMap.Polyline({
    path,
    strokeColor: color,
    strokeOpacity: 1,
    strokeWeight: width,
    strokeStyle: dashed ? 'dashed' : 'solid',
    strokeDasharray: dashed ? [12, 8] : undefined,
    lineJoin: 'round',
    lineCap: 'round',
    showDir,
    zIndex: zIndex + 1
  });

  return [halo, line];
}
```

注意：

如果当前使用的 AMap JS API 版本：

```js
lineJoin
lineCap
strokeDasharray
```

某个属性不支持，不要因此让整个功能失败。

保留核心：

```js
strokeColor
strokeWeight
strokeOpacity
strokeStyle
zIndex
```

即可。

---

## 10. 步行路线样式

步行必须明显区别于地铁。

建议：

```text
颜色：#64748B
线宽：7
线型：虚线
白色 halo：14
zIndex：120
```

代码：

```js
function renderWalking(path) {
  return createStrongPolyline({
    path,
    color: '#64748B',
    width: 7,
    dashed: true,
    zIndex: 120,
    showDir: true
  });
}
```

最终效果应该类似：

```text
· · · · · · · · ·
```

而不能是一条和道路很像的普通细线。

---

## 11. 地铁路线样式

地铁是公共交通路线最重要的部分。

要求：

```text
strokeWeight: 11~12
白色 halo: +7
strokeOpacity: 1
```

建议：

```js
function renderSubway(path, lineName) {
  const color = getMetroColor(lineName);

  return createStrongPolyline({
    path,
    color,
    width: 11,
    dashed: false,
    zIndex: 140
  });
}
```

---

## 12. 上海地铁颜色映射

当前项目如果经常测试上海，可以先使用以下颜色。

不需要做到与官方色 100% 一致。

核心要求：

> 相邻换乘线路必须颜色明显不同。

```js
const SHANGHAI_METRO_COLORS = {
  '1号线': '#E53935',
  '2号线': '#65B32E',
  '3号线': '#F4C430',
  '4号线': '#6A3D9A',
  '5号线': '#A93226',
  '6号线': '#D81B60',
  '7号线': '#F57C00',
  '8号线': '#1565C0',
  '9号线': '#7B1FA2',
  '10号线': '#8E7CC3',
  '11号线': '#8E24AA',
  '12号线': '#00897B',
  '13号线': '#E67E22',
  '14号线': '#5E35B1',
  '15号线': '#9575CD',
  '16号线': '#7CB342',
  '17号线': '#00ACC1',
  '18号线': '#795548'
};
```

实现：

```js
function getMetroColor(lineName = '') {
  for (const [line, color] of Object.entries(SHANGHAI_METRO_COLORS)) {
    if (lineName.includes(line)) {
      return color;
    }
  }

  return getStableColorFromName(lineName, METRO_FALLBACK_COLORS);
}
```

---

## 13. 非上海地铁不能失效

不能把逻辑写死为上海。

如果：

```text
广州
北京
深圳
成都
杭州
东京
其他城市
```

没有颜色映射，则使用：

```js
const METRO_FALLBACK_COLORS = [
  '#2563EB',
  '#DC2626',
  '#16A34A',
  '#9333EA',
  '#EA580C',
  '#0891B2',
  '#DB2777',
  '#4F46E5',
  '#65A30D',
  '#C2410C'
];
```

按照线路名字 hash：

```js
function getStableColorFromName(name = '', palette) {
  let hash = 0;

  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  }

  return palette[Math.abs(hash) % palette.length];
}
```

这样：

```text
2号线
11号线
13号线
```

即使没有硬编码，也能稳定获得不同颜色。

---

## 14. 公交路线样式

公交不能和地铁完全一样。

推荐：

```text
线宽：8
zIndex：130
```

颜色：

```js
const BUS_COLORS = [
  '#F97316',
  '#0D9488',
  '#0284C7',
  '#65A30D',
  '#C026D3',
  '#EA580C'
];
```

实现：

```js
function renderBus(path, lineName) {
  return createStrongPolyline({
    path,
    color: getStableColorFromName(lineName, BUS_COLORS),
    width: 8,
    dashed: false,
    zIndex: 130
  });
}
```

---

## 15. 铁路 / 高铁样式

如果高德返回：

```text
railway
```

或者类似铁路 segment，则：

```text
颜色：#0891B2
线宽：10
zIndex：135
```

例如：

```js
function renderRailway(path) {
  return createStrongPolyline({
    path,
    color: '#0891B2',
    width: 10,
    dashed: false,
    zIndex: 135
  });
}
```

---

## 16. 不要假设高德返回结构永远相同

这是本次修改非常重要的一点。

不要直接假设：

```js
segment.bus.buslines[0].path
```

一定存在。

需要对真实返回结构做兼容。

Codex 修改代码之前：

### 必须先检查当前 API 返回结果

临时输出：

```js
console.debug('[Transit] raw result:', result);
console.debug('[Transit] selected plan:', plan);
```

检查：

```text
plan
segments
walking
bus
buslines
railway
path
polyline
via_stops
departure_stop
arrival_stop
```

真实结构。

然后根据实际项目当前使用的：

```text
AMap JS API
Web Service API
后端代理 API
```

返回字段编写 parser。

不要为了符合本文档而硬写不存在的字段。

---

## 17. 通用路径解析函数

建议新增：

```js
function normalizeLngLat(point) {
  if (!point) {
    return null;
  }

  if (
    typeof point.getLng === 'function' &&
    typeof point.getLat === 'function'
  ) {
    return point;
  }

  if (
    typeof point.lng === 'number' &&
    typeof point.lat === 'number'
  ) {
    return new AMap.LngLat(point.lng, point.lat);
  }

  if (
    Array.isArray(point) &&
    point.length >= 2
  ) {
    return new AMap.LngLat(
      Number(point[0]),
      Number(point[1])
    );
  }

  if (typeof point === 'string') {
    const parts = point.split(',');

    if (parts.length >= 2) {
      const lng = Number(parts[0]);
      const lat = Number(parts[1]);

      if (
        Number.isFinite(lng) &&
        Number.isFinite(lat)
      ) {
        return new AMap.LngLat(lng, lat);
      }
    }
  }

  return null;
}
```

---

## 18. 解析 polyline 字符串

部分接口可能返回：

```text
121.123,31.123;121.124,31.124;121.125,31.125
```

实现：

```js
function parsePolylineString(polyline) {
  if (
    !polyline ||
    typeof polyline !== 'string'
  ) {
    return [];
  }

  return polyline
    .split(';')
    .map(item => normalizeLngLat(item))
    .filter(Boolean);
}
```

---

## 19. 通用 path 提取函数

实现：

```js
function extractPath(source) {
  if (!source) {
    return [];
  }

  if (Array.isArray(source.path)) {
    return source.path
      .map(normalizeLngLat)
      .filter(Boolean);
  }

  if (typeof source.polyline === 'string') {
    return parsePolylineString(source.polyline);
  }

  return [];
}
```

---

## 20. Walking path

Walking 很可能由多个 step 组成：

```js
function extractWalkingPath(walking) {
  if (!walking) {
    return [];
  }

  const path = [];

  if (Array.isArray(walking.steps)) {
    for (const step of walking.steps) {
      path.push(...extractPath(step));
    }
  }

  path.push(...extractPath(walking));

  return dedupePath(path);
}
```

---

## 21. path 去重

```js
function dedupePath(path) {
  const result = [];

  let lastKey = null;

  for (const point of path) {
    if (!point) continue;

    const lng =
      typeof point.getLng === 'function'
        ? point.getLng()
        : point.lng;

    const lat =
      typeof point.getLat === 'function'
        ? point.getLat()
        : point.lat;

    const key =
      `${Number(lng).toFixed(6)},${Number(lat).toFixed(6)}`;

    if (key === lastKey) {
      continue;
    }

    result.push(point);
    lastKey = key;
  }

  return result;
}
```

不要使用全局 `Set` 删除所有重复点。

因为某些路线可能存在：

```text
往返
折返
局部重合
```

只删除连续重复点即可。

---

## 22. 地铁 / 公交类型识别

不要只用：

```js
lineName.includes('地铁')
```

因为可能存在：

```text
2号线
地铁2号线
轨道交通2号线
Metro Line 2
磁浮线
轻轨
```

实现：

```js
function isSubwayLine(line) {
  const name =
    line?.name ??
    line?.lineName ??
    line?.type ??
    '';

  const text =
    String(name).toLowerCase();

  return (
    text.includes('地铁') ||
    text.includes('轨道交通') ||
    text.includes('号线') ||
    text.includes('metro') ||
    text.includes('subway') ||
    text.includes('轻轨') ||
    text.includes('磁浮') ||
    text.includes('磁悬浮')
  );
}
```

如果实际 API 返回明确：

```js
type
vehicle_type
bus_type
```

则优先使用结构化类型。

字符串判断只作为 fallback。

---

## 23. Bus / Subway segment 渲染

示例：

```js
function renderBusSegment(segment) {
  const overlays = [];

  const buslines =
    segment?.bus?.buslines ??
    segment?.buslines ??
    [];

  for (const line of buslines) {
    const path = extractPath(line);

    if (path.length < 2) {
      continue;
    }

    const lineName =
      line.name ??
      line.lineName ??
      '';

    if (isSubwayLine(line)) {
      overlays.push(
        ...renderSubway(path, lineName)
      );
    } else {
      overlays.push(
        ...renderBus(path, lineName)
      );
    }
  }

  return overlays;
}
```

注意：

上面的字段只是兼容模板。

最终请以真实返回结果为准。

---

## 24. 核心 `renderTransitPlan`

目标结构：

```js
function renderTransitPlan(
  map,
  plan
) {
  if (!map || !plan) {
    return;
  }

  clearTransitOverlays(map);

  const overlays = [];
  const routeOverlaysForFitView = [];

  const segments =
    plan.segments ?? [];

  for (const segment of segments) {

    if (segment.walking) {
      const walkingPath =
        extractWalkingPath(
          segment.walking
        );

      if (walkingPath.length >= 2) {
        const items =
          renderWalking(
            walkingPath
          );

        overlays.push(...items);
        routeOverlaysForFitView.push(
          ...items
        );
      }
    }

    const busItems =
      renderBusSegment(
        segment
      );

    overlays.push(...busItems);
    routeOverlaysForFitView.push(
      ...busItems
    );

    if (segment.railway) {
      const railwayPath =
        extractPath(
          segment.railway
        );

      if (railwayPath.length >= 2) {
        const railwayItems =
          renderRailway(
            railwayPath
          );

        overlays.push(
          ...railwayItems
        );

        routeOverlaysForFitView.push(
          ...railwayItems
        );
      }
    }
  }

  if (overlays.length === 0) {
    console.warn(
      '[Transit] no drawable route overlays',
      plan
    );

    return;
  }

  map.add(overlays);

  transitOverlays =
    overlays;

  requestAnimationFrame(() => {
    map.setFitView(
      routeOverlaysForFitView,
      false,
      [70, 70, 70, 70]
    );
  });
}
```

React 项目请替换：

```js
transitOverlays =
```

为：

```js
transitOverlaysRef.current =
```

---

## 25. 起点 / 终点 Marker

保留当前：

```text
A
B
```

Marker。

如果现有 Marker 已经清晰，不需要修改。

视觉要求：

```text
A = 蓝色
B = 红色
```

zIndex 要大于路线：

```js
zIndex: 200
```

---

## 26. 换乘点必须明显

公共交通中最重要的信息之一：

```text
地铁 2 号线
     ↓
换乘
     ↓
地铁 11 号线
```

建议在换乘站添加 CircleMarker。

例如：

```js
function createTransferMarker(
  position,
  color = '#FFFFFF'
) {
  return new AMap.CircleMarker({
    center: position,
    radius: 7,
    fillColor: '#FFFFFF',
    fillOpacity: 1,
    strokeColor: '#334155',
    strokeWeight: 3,
    zIndex: 170
  });
}
```

视觉效果：

```text
━━━━━━◉━━━━━━
```

如果可以获得站名：

```text
南京东路
江苏路
迪士尼
```

则允许使用：

```js
AMap.Text
```

或者 Marker label。

但不要默认所有站都显示文字。

否则地图会非常乱。

优先显示：

```text
起点站
换乘站
终点站
```

---

## 27. 推荐线路图例

当前项目已经存在：

```text
步行
地铁
公交
铁路/高铁
出租车
```

请确保图例颜色和地图真实线路一致。

不要再出现：

```text
图例：地铁 = 紫色

实际：
2号线绿色
11号线紫色
```

这种情况。

建议图例改成：

```text
- - - 步行
━━━ 地铁 / 轨道交通
━━━ 公交
━━━ 铁路 / 高铁
```

地铁 legend 可以使用：

```text
多色渐变
```

或者统一写：

```text
轨道交通
```

不要暗示所有地铁都是一种颜色。

---

## 28. 公共交通模式下弱化底图

现在的高德底图：

```text
道路颜色很多
地铁线很多
POI 很多
```

容易和路线冲突。

进入公共交通模式时，可以考虑：

```js
map.setMapStyle(
  'amap://styles/whitesmoke'
);
```

如果项目已有自定义地图 style：

优先使用现有 style。

要求：

```text
底图 = 信息背景
推荐路线 = 视觉主体
```

不能反过来。

---

## 29. 不允许把所有底图 POI 全部关闭

不要为了突出路线，把地图变成空白。

仍然需要保留：

```text
道路
地名
主要 POI
区域
```

只需要适当弱化。

---

## 30. 路线宽度要求

最终建议：

| 类型 | 彩色线宽 | 白色 halo | zIndex |
|---|---:|---:|---:|
| 步行 | 7 | 14 | 120 |
| 公交 | 8 | 15 | 130 |
| 铁路/高铁 | 10 | 17 | 135 |
| 地铁 | 11 | 18 | 140 |
| 换乘 Marker | - | - | 170 |
| A/B Marker | - | - | 200 |

不要使用：

```text
2px
3px
4px
```

这种线宽。

目前最大的问题就是线路视觉层级太弱。

---

## 31. 为什么一定要有白色 Halo

例如底图本身存在：

```text
绿色地铁线
橙色道路
紫色地铁线
黄色高速
```

假设推荐路线也是：

```text
绿色
```

则直接：

```text
绿色线路
```

会和底图融合。

使用：

```text
白色 18px
绿色 11px
```

后：

```text
底图

████████████
 ██████████   ← 推荐线路

底图
```

即使线路颜色和底图类似，也仍然可以明显看出路线。

这是本次修改中最重要的视觉修复之一。

---

## 32. 当前选中路线必须比候选路线突出

如果页面以后同时显示多条公共交通方案：

不要把所有路线都用：

```text
opacity = 1
width = 11
```

建议：

### 当前选中

```text
opacity: 1
width: 11
zIndex: 140
```

### 未选中

```text
opacity: 0.25
width: 6
zIndex: 100
```

用户点击候选方案后：

```text
旧路线 dim
新路线 highlight
```

---

## 33. 禁止在地图上直接连接两个站点坐标

非常重要。

不要为了让路线看起来明显，而做：

```js
new AMap.Polyline({
  path: [
    stationA.location,
    stationB.location
  ]
});
```

这会形成：

```text
A ─────────── B
```

直线。

这是错误的。

必须优先使用高德 API 返回的：

```text
path
polyline
steps
```

真实线路几何。

如果某个 transit segment 完全没有 geometry：

不要伪造道路路线。

应该：

1. 检查是否可以从其他字段获得 geometry
2. 检查当前使用的 API 类型是否只返回站点
3. 必要时再调用对应路线 / WebService 获取 geometry

但不能假装直线就是实际线路。

---

## 34. Railway 同样不能使用两站直线代替

如果：

```text
上海虹桥站
↓
杭州东站
```

API 只返回两个站坐标，没有铁路 polyline。

不要直接画一条：

```text
上海 ───────── 杭州
```

并当作真实铁路走向。

没有实际 geometry 时：

可以只：

```text
显示站点
```

并在 UI 中保留铁路 segment 信息。

---

## 35. `AMap.Transfer` 搜索成功后的调用

现有类似：

```js
transfer.search(
  start,
  end,
  (status, result) => {

  }
);
```

修改为：

```js
transfer.search(
  start,
  end,
  (status, result) => {
    if (
      status !== 'complete' ||
      !result
    ) {
      console.error(
        '[Transit] search failed',
        status,
        result
      );

      return;
    }

    console.debug(
      '[Transit] search result',
      result
    );

    const plan =
      pickTransitPlan(
        result
      );

    if (!plan) {
      console.warn(
        '[Transit] no available plan',
        result
      );

      return;
    }

    renderTransitPlan(
      mapInstance,
      plan
    );
  }
);
```

---

## 36. `pickTransitPlan`

不要完全假设只有：

```js
result.plans
```

先检查项目当前真实结果。

可以写成兼容形式：

```js
function pickTransitPlan(result) {
  if (
    Array.isArray(result?.plans) &&
    result.plans.length > 0
  ) {
    return result.plans[0];
  }

  if (
    Array.isArray(result?.routes) &&
    result.routes.length > 0
  ) {
    return result.routes[0];
  }

  return null;
}
```

如果现有项目已经存在：

```text
selectedRouteIndex
selectedPlan
activeTransitPlan
```

则不要永远取 `[0]`。

应该：

```js
const plan =
  plans[selectedRouteIndex];
```

保证地图和 UI 当前选择的方案一致。

---

## 37. 切换驾车 / 公交

### 切换到公共交通

需要：

```text
1. 清除 Driving overlays
2. 清除旧 Transit overlays
3. 查询 Transit
4. 绘制新的 Transit overlays
5. fitView
```

### 切换到驾车

需要：

```text
1. 清除 Transit overlays
2. 恢复 Driving
3. fitView Driving
```

不能出现：

```text
蓝色驾车线
+
地铁线
+
公交线
```

同时残留。

---

## 38. 推荐代码文件拆分

如果现有项目允许，可以拆成：

```text
src/
  map/
    transitRenderer.ts
    routeColors.ts
    routeParser.ts
```

例如：

```text
routeColors.ts

getMetroColor()
getBusColor()
getStableColorFromName()
```

```text
routeParser.ts

extractPath()
extractWalkingPath()
normalizeLngLat()
isSubwayLine()
```

```text
transitRenderer.ts

renderTransitPlan()
renderWalking()
renderSubway()
renderBus()
renderRailway()
createStrongPolyline()
```

但如果当前项目很小，不要为了架构而架构。

也可以放在现有：

```text
map.ts
route.ts
MapComponent.tsx
```

中。

---

## 39. TypeScript 类型

如果项目使用 TypeScript：

不要大量使用：

```ts
as any
```

但是考虑到高德 SDK 类型可能不完整，可以对 API 边界适当使用。

建议定义自己的：

```ts
type TransitPathPoint =
  | {
      lng: number;
      lat: number;
    }
  | [number, number]
  | string;
```

以及：

```ts
interface TransitRenderStyle {
  color: string;
  width: number;
  dashed?: boolean;
  zIndex: number;
}
```

不要为了 TS 类型修复大规模修改业务。

---

## 40. Debug 输出

开发阶段加入：

```js
console.debug(
  '[Transit] plan segments',
  plan.segments
);
```

每个 segment 输出：

```js
console.debug(
  '[Transit] segment',
  {
    walking: !!segment.walking,
    bus: !!segment.bus,
    railway: !!segment.railway,
    raw: segment
  }
);
```

每条线路：

```js
console.debug(
  '[Transit] line',
  {
    name: lineName,
    type:
      isSubwayLine(line)
        ? 'subway'
        : 'bus',
    points:
      path.length
  }
);
```

如果 path：

```text
0
1
```

不要静默失败。

输出：

```js
console.warn(
  '[Transit] invalid geometry',
  line
);
```

功能稳定以后可以保留 warn/error，删除过量 debug。

---

## 41. 验收用例

至少测试：

### Case A

```text
上海虹桥机场
→
上海迪士尼
```

重点：

```text
长距离地铁
多条线路
可能换乘
步行
```

### Case B

```text
人民广场
→
陆家嘴
```

重点：

```text
短距离地铁
路线清晰度
```

### Case C

```text
虹桥火车站
→
上海南站
```

重点：

```text
多公共交通选择
换乘节点
```

### Case D

随便一个：

```text
步行
+
公交
+
地铁
```

混合路线。

必须验证三种线型肉眼明显不同。

---

## 42. 最终视觉验收标准

### 42.1 整条公共交通路线一眼可见

用户打开地图后，不需要仔细寻找，就可以看到：

```text
A
↓
路线
↓
B
```

### 42.2 路线视觉强度接近驾车路线

不能出现：

```text
驾车：
████████████

公交：
----------
```

而应该：

```text
驾车：
████████████

公共交通：
████████████
```

视觉权重要接近。

### 42.3 步行必须和地铁明显不同

例如：

```text
步行：

- - - - - - - -

地铁：

━━━━━━━━━━━━━━
```

### 42.4 不同地铁线路必须明显不同

例如：

```text
2号线  = 绿色
11号线 = 紫色

换乘：
━━━━━━◉━━━━━━
```

不能所有地铁都画成同一个紫色。

### 42.5 推荐线路不能与底图地铁线混淆

必须通过：

```text
白色 halo
+
粗线
+
更高 zIndex
```

保证推荐路线浮在地图之上。

### 42.6 起终点必须明显

```text
A = 蓝色 Marker
B = 红色 Marker
```

不可被路线覆盖。

### 42.7 换乘点明显

至少应该能够看到：

```text
●
```

或者：

```text
◉
```

不能只靠线路颜色变化让用户猜。

---

## 43. 重点检查“为什么第一次修改没有效果”

如果完成上述代码后，地图仍然和之前一样：

### 问题 1：默认 `AMap.Transfer` 线路还在

搜索整个项目：

```text
new AMap.Transfer
```

确认不存在：

```js
map: mapInstance
```

否则默认路线和自定义路线会叠加。

### 问题 2：自定义 Polyline 根本没加到地图

确认：

```js
map.add(overlays)
```

真的执行。

日志：

```js
console.debug(
  '[Transit] overlay count:',
  overlays.length
);
```

正常应该：

```text
> 0
```

### 问题 3：path 没解析出来

输出：

```js
console.debug(
  '[Transit] geometry point count:',
  path.length
);
```

如果一直：

```text
0
```

问题不是样式，而是 parser 错了。

这时必须重新检查：

```js
console.log(result)
```

的真实 API 返回结构。

### 问题 4：zIndex 太低

确保：

```text
地铁 >= 140
公交 >= 130
步行 >= 120
```

推荐路线必须覆盖在普通底图道路之上。

### 问题 5：白色 Halo 没画

确认每段线路实际上创建：

```text
2 个 Polyline
```

而不是：

```text
1 个
```

例如：

```js
const overlays =
  createStrongPolyline(...);

console.log(overlays.length);
```

应该：

```text
2
```

---

## 44. 不要使用 CSS 解决线路问题

不要继续尝试类似：

```css
.amap-line {
  stroke-width: 10px !important;
}
```

或者：

```css
.amap-overlay {
  ...
}
```

作为主要解决方案。

路线视觉应该直接由：

```js
AMap.Polyline
```

控制。

CSS 只负责：

```text
Panel
Card
Legend
Button
Tooltip
```

---

## 45. 不修改驾车路线

当前驾车路线已经非常清晰。

除非为了：

```text
overlay cleanup
mode switching
```

否则不要修改 Driving 的视觉。

目标是让：

```text
公共交通
```

达到和：

```text
驾车
```

相近的清晰程度。

---

## 46. 建议最终效果

地图视觉应该大致表现为：

```text
             A
             ●
             ╲
              ╲
             - - - - - -          步行
                       ◉
                       ║
                       ║  地铁2号线（绿色）
                       ║
                       ║
                       ◉ 换乘
                       ║
                       ║  地铁11号线（紫色）
                       ║
                       ║
                       ◉
                        - - - - -
                                  B
                                  ●
```

其中：

```text
步行
=
灰色粗虚线

地铁2号线
=
绿色粗实线 + 白色描边

地铁11号线
=
紫色粗实线 + 白色描边

换乘站
=
白色圆心 + 深色边框

起点
=
蓝色 A

终点
=
红色 B
```

---

## 47. 完成后必须自行验证

修改完成后：

1. 启动开发服务器

```bash
npm run dev
```

2. 打开项目页面

3. 搜索：

```text
上海虹桥机场
→
上海迪士尼
```

4. 分别切换：

```text
驾车
公共交通
```

5. 比较两张地图

必须确认：

```text
公共交通路线与驾车路线一样明显
```

尤其确认：

```text
√ 步行看得出来
√ 地铁看得出来
√ 不同地铁线颜色不同
√ 换乘点看得出来
√ 起终点明确
√ 底图不会盖住推荐路线
```

---

## 48. 完成后的输出

修改完成后，请向我汇报：

### 修改文件

列出：

```text
src/xxx.ts
src/xxx.tsx
...
```

### 核心修改

说明：

```text
1. 移除 AMap.Transfer 默认地图渲染
2. 新增自定义 transit renderer
3. 新增双层 Polyline halo
4. 新增 walking/subway/bus/railway 分类
5. 新增地铁线路颜色映射
6. 新增换乘点
7. 修复 overlay 清理和 fitView
```

### 实际 API 数据结构

明确告诉我当前高德 API 实际返回：

```text
result.xxx
plan.xxx
segment.xxx
```

而不是只告诉我“已经支持”。

尤其列出：

```text
walking geometry 从哪里取
subway geometry 从哪里取
bus geometry 从哪里取
railway geometry 从哪里取
```

### 验证结果

报告：

```text
上海虹桥机场 → 上海迪士尼
```

实际测试结果。

如果某一种 segment 无法获得真实 geometry，也必须明确说明：

```text
哪种类型
缺失什么字段
当前 fallback 是什么
```

不要静默使用站点直线代替实际路线。

---

## 49. 本任务最重要的原则

不要再围绕：

```text
修改 CSS
调整默认 Transfer 样式
```

反复尝试。

这次直接从根本解决：

```text
AMap.Transfer

只查询
   ↓
拿到 segments
   ↓
自行解析 geometry
   ↓
自行 AMap.Polyline
   ↓
白色 Halo
   +
粗彩色路线
   +
不同交通方式不同样式
```

这是本次修复的核心。

最终优先级：

```text
路线清晰度
>
地图默认美观
```

用户必须能够在 1 秒内看出：

```text
从 A 到 B 到底怎么坐公共交通。
```
