#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { flights, roundtripFlights, trains, hotels, hotelDetail, resolveHotelCity } from '../../src/ctrip/service.js';
import { opencliError } from '../../src/ctrip/opencli.js';
import { flightShape, roundtripShape, trainShape, hotelShape, hotelDetailShape, hotelCityShape } from './schemas.js';

const server = new McpServer({ name: 'ctrip-travel-mcp', version: '0.1.0' });
function tool(name, description, inputSchema, handler) {
  server.registerTool(name, { description, inputSchema, annotations: { readOnlyHint: true } }, async (input) => {
    try { const data = await handler(input); return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], structuredContent: data }; }
    catch (error) { const issue = opencliError(error); return { isError: true, content: [{ type: 'text', text: JSON.stringify(issue, null, 2) }] }; }
  });
}
tool('search_flights', '查询中国国内单程机票（只读）。价格可能变化。', flightShape, flights);
tool('search_roundtrip_flights', '查询国内往返机票（只读）；当前返程具体航班未完整解析。', roundtripShape, roundtripFlights);
tool('search_trains', '查询高铁、动车及普通列车（只读）。', trainShape, trains);
tool('search_hotels', '按自然语言城市查询酒店首屏列表（只读）。', hotelShape, hotels);
tool('get_hotel_detail', '查询酒店详情（只读）。', hotelDetailShape, hotelDetail);
tool('resolve_hotel_city', '解析携程酒店城市 ID（只读）。', hotelCityShape, resolveHotelCity);
await server.connect(new StdioServerTransport());
