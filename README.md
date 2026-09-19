# Travel Planner Demos

一个可本地运行的旅行信息聚合 Demo，集中展示三条互相独立的能力：

- **高德路线规划**：地点解析、驾车路线、综合公共交通路线与地图绘制。
- **携程交通与住宿**：通过 OpenCLI 查询机票、列车和酒店，并导出静态报告。
- **小红书旅行攻略**：只读检索帖子，保留原始响应和来源，再生成 HTML 攻略。

项目使用 Node.js、Express 和原生 JavaScript。三个 Demo 共用一个本地服务，但可以分别配置、分别体验。

## 已实现效果

| Demo | 已实现 | 数据来源 / 依赖 | 入口 |
| --- | --- | --- | --- |
| 高德 | POI 识别；驾车和公交路线；道路、站点、距离、耗时；真实 geometry 绘制 | 高德 Web 服务 API + JS API | `/amap.html` |
| 携程 | 国内机票、列车、住宿查询；筛选；原始响应落盘；HTML 报告 | 本地 OpenCLI、`ctrip` adapter、Chrome Browser Bridge | `/ctrip.html` |
| 小红书 | 登录检查；搜索；帖子详情；多帖共识；来源链接；静态攻略 | 本地小红书 MCP | `/xiaohongshu.html` |

启动后访问 <http://localhost:3000> 可以看到统一入口。

### 已生成的 HTML 示例

这些文件会随仓库保留，未配置第三方服务时也可直接用浏览器打开：

- [携程交通与住宿查询报告](output/ctrip-live-demo.html)
- [香格里拉旅行攻略](output/香格里拉.html)
- [京都旅行攻略](output/京都.html)
- [上海旅行攻略](output/上海.html)

示例是生成时刻的结果快照，仅用于展示页面和数据结构。票价、余票、营业信息与旅行建议都可能变化，请以来源平台的当前页面为准。

## 快速开始

### 1. 安装

要求 Node.js 20 或更高版本。项目使用原生 `fetch` 和 `AbortSignal.timeout`，依赖包也以当前 Node LTS 为基线。

```bash
git clone <your-repository-url>
cd Travel-Planner
npm install
cp .env.example .env
```

### 2. 配置

编辑项目根目录的 `.env`：

```dotenv
# 高德：使用高德 Demo 时必填
AMAP_WEB_SERVICE_KEY=
AMAP_JSAPI_KEY=
AMAP_JSAPI_SECURITY_CODE=

# 小红书：使用在线攻略生成时填写；以下为默认值
XIAOHONGSHU_MCP_URL=http://127.0.0.1:18060/mcp

# 携程：opencli 不在 PATH 中时填写绝对路径
OPENCLI_BIN=opencli

# 可选
PORT=3000
```

不同 Demo 的依赖是独立的：只看静态示例不需要 Key；只运行高德 Demo 也不需要安装 OpenCLI 或小红书 MCP。

### 3. 启动

```bash
npm run dev
```

生产式启动可使用 `npm start`。修改端口后，请访问 `.env` 中 `PORT` 对应的地址。

## 三个 Demo 如何使用

### 高德路线规划

1. 在高德开放平台创建 **Web 服务** Key，填入 `AMAP_WEB_SERVICE_KEY`。
2. 创建 **Web 端（JS API）** Key，将 Key 和安全密钥分别填入 `AMAP_JSAPI_KEY`、`AMAP_JSAPI_SECURITY_CODE`。
3. 启动项目，打开 <http://localhost:3000/amap.html>。
4. 输入起点与终点，切换查看驾车或公共交通。

后端负责 POI 搜索与路径计算，Web 服务 Key 不会返回浏览器。浏览器只接收归一化后的地点、路线和坐标；JS API Key 用于加载底图。当前安全密钥直传方案只适合本地 Demo，公开部署时应按高德文档改成安全代理。

可用以下路线快速验证：

- 上海虹桥火车站 → 上海迪士尼度假区
- 广州南站 → 广州塔
- 输入一串不存在的地点，验证“地点未找到”错误

公共交通会按高德返回内容区分步行、公交、地铁、铁路/高铁和出租车段。缺失 geometry 时不会用两站之间的直线伪造路线。

### 携程交通与住宿

携程 Demo 依赖本机 OpenCLI、可用的 `ctrip` adapter、Chrome Browser Bridge，以及必要时已完成登录/验证的浏览器会话。项目自身不会绕过登录或验证码，也不包含下单、支付等写操作。

确认命令可用：

```bash
opencli --version
opencli ctrip --help
```

然后启动项目并打开 <http://localhost:3000/ctrip.html>。查询成功后可以在页面生成 `output/ctrip-report.html`。每次上游原始响应会先保存到 `data/raw/ctrip/`，再进入归一化与展示流程。

项目还包含一个只读 MCP Server，可选注册到 Codex：

```bash
npm run ctrip:mcp:build
codex mcp add ctrip-travel -- node /absolute/path/to/Travel-Planner/ctrip-travel-mcp/src/index.js
```

MCP 提供 `search_flights`、`search_roundtrip_flights`、`search_trains`、`search_hotels`、`get_hotel_detail` 和 `resolve_hotel_city`。更详细的接口说明见 [ctrip-travel-mcp/README.md](ctrip-travel-mcp/README.md)。

### 小红书旅行攻略

在线生成需要先启动兼容的小红书 MCP，并在其浏览器会话中完成登录。默认地址为 `http://127.0.0.1:18060/mcp`；地址不同时修改 `XIAOHONGSHU_MCP_URL`。

打开 <http://localhost:3000/xiaohongshu.html>，输入目的地后生成。一次完整流程为：

```text
check_login_status
  → 规划攻略 / 景点 / 行程 / 路线 / 美食 / 住宿 / 避坑等查询
  → search_feeds（候选合并、互动量与相关性排序、近重复去重）
  → 原始搜索响应写入 data/raw/
  → get_feed_detail（默认目标 20 篇，按内容类型平衡抽样）
  → 原始详情写入 data/raw/posts/
  → 单帖压缩、实体规范化、多帖共识聚合
  → data/processed/*.json
  → output/<目的地>.html
```

小红书部分有明确的只读边界：

- 代码只允许 `check_login_status`、`search_feeds`、`get_feed_detail` 三个工具。
- 不调用发布、评论、点赞或收藏功能。
- MCP 搜索和详情响应必须先写入 `data/raw/`，再生成攻略。
- 同一推荐至少出现于两个不同 `feedId`，才会标记为“多帖共同提及”。
- 来源链接优先使用 MCP 返回的 URL；缺失时只在适配层用 `feedId` 与保留的 `xsecToken` 生成标准 `explore/{feed_id}` 链接。

也可以完全离线生成一份明确标注的演示攻略：

```bash
npm run guide:demo -- 京都
open output/京都.html
```

若已按约定准备好 `data/raw/<目的地>-posts.json`，运行：

```bash
npm run guide -- 京都
```

## 目录结构

```text
Travel-Planner/
├── public/                 # 统一首页与三个 Demo 前端
│   ├── index.html
│   ├── amap.html
│   ├── ctrip.html
│   └── xiaohongshu.html
├── src/
│   ├── amap/               # POI、驾车、公交与归一化
│   ├── ctrip/              # OpenCLI 调用、归一化、报告
│   └── xiaohongshu/        # 只读 MCP、研究、攻略生成
├── ctrip-travel-mcp/       # 可独立注册的携程只读 MCP Server
├── scripts/                # CLI 生成与导入脚本
├── data/
│   ├── raw/                # 第三方原始响应，不提交 Git
│   └── processed/          # 中间结果，不提交 Git
├── output/                 # 可提交、可直接打开的 HTML 示例
├── docs/                   # 设计与修复记录
├── server.js               # Express API 与静态文件入口
└── .env.example            # 环境变量模板
```

## 常用命令

```bash
npm run dev                 # 监听文件变化并启动服务
npm start                   # 启动服务
npm run check               # 静态语法与 MCP 构建检查
npm run guide -- 京都       # 从已有 raw 数据生成攻略
npm run guide:demo -- 京都  # 生成离线演示数据与攻略
npm run ctrip:mcp:build     # 检查携程 MCP
```

## 本地 API

| Method | Path | 作用 |
| --- | --- | --- |
| `GET` | `/api/config` | 返回高德浏览器端配置 |
| `POST` | `/api/routes` | 查询高德驾车与公共交通路线 |
| `POST` | `/api/ctrip/search` | 查询机票、列车或住宿 |
| `POST` | `/api/ctrip/report` | 将携程结果写成 HTML |
| `POST` | `/api/xiaohongshu/guides` | 在线检索并生成小红书攻略 |
| `POST` | `/api/guides` | 从已保存帖子或演示数据生成攻略 |

## 数据与安全说明

- `.env`、`data/raw/`、`data/processed/` 和 `node_modules/` 已加入 `.gitignore`。
- `output/` 有意保留在仓库中，用于展示生成效果；提交前请检查报告中是否含不适合公开的信息。
- 携程与小红书功能均为只读研究 Demo，不执行交易或账号互动。
- 第三方页面结构、接口字段和访问策略变化时，适配层可能需要更新。
- 酒店搜索目前仅代表携程首屏候选；往返航班的返程明细尚未完整解析。

## 校验

```bash
npm run check
```

该命令会检查服务端、三个前端脚本与核心模块的 JavaScript 语法，并执行携程 MCP 的构建检查。
