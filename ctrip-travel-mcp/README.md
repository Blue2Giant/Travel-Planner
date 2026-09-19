# ctrip-travel-mcp（只读）

只读本地 MCP：通过 OpenCLI 的 `ctrip` adapter 查询国内机票、列车与酒店。它不包含登录、下单、支付或验证码绕过能力。

前置条件：本机已安装 OpenCLI，已有可用的 `ctrip` adapter 和 Chrome Browser Bridge，并在 Chrome 中完成携程需要的登录/验证。

```bash
npm run build
codex mcp add ctrip-travel -- node /absolute/path/to/Travel-Planner/ctrip-travel-mcp/src/index.js
```

每个上游 OpenCLI 原始响应会先写入项目 `data/raw/ctrip/`，再归一化为 MCP 返回结果。酒店仅覆盖携程首屏结果；价格均可能变动。

## Tools

- `search_flights`：国内单程航班。
- `search_roundtrip_flights`：往返航班候选；当前返程明细不完整。
- `search_trains`：列车与席位摘要。
- `search_hotels`：城市首屏酒店候选。
- `get_hotel_detail`：酒店基础详情。
- `resolve_hotel_city`：将城市名解析为携程城市 ID。

该 Server 没有登录、下单、支付、评论等写操作。
