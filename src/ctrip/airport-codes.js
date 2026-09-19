export const AIRPORT_CODES = Object.freeze({
  北京: 'BJS', 上海: 'SHA', 广州: 'CAN', 深圳: 'SZX', 成都: 'CTU', 重庆: 'CKG', 西安: 'XIY', 杭州: 'HGH', 南京: 'NKG', 武汉: 'WUH', 长沙: 'CSX', 青岛: 'TAO', 厦门: 'XMN', 福州: 'FOC', 昆明: 'KMG', 丽江: 'LJG', 香格里拉: 'DIG', 迪庆: 'DIG', 三亚: 'SYX', 海口: 'HAK', 乌鲁木齐: 'URC', 哈尔滨: 'HRB', 沈阳: 'SHE', 大连: 'DLC', 郑州: 'CGO', 天津: 'TSN', 济南: 'TNA', 桂林: 'KWL', 南宁: 'NNG', 宁波: 'NGB', 温州: 'WNZ', 合肥: 'HFE'
});

export function airportCode(city) {
  const value = String(city || '').trim().toUpperCase();
  if (/^[A-Z]{3}$/.test(value)) return value;
  const code = AIRPORT_CODES[String(city || '').trim()];
  if (!code) {
    const error = new Error(`不支持的出发/到达城市“${city}”。请使用三字 IATA 代码，或补充机场映射。`);
    error.code = 'INVALID_CITY';
    throw error;
  }
  return code;
}
