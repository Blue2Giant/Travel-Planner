export const AIRPORT_CODES = Object.freeze({
  北京: 'BJS', 上海: 'SHA', 广州: 'CAN', 深圳: 'SZX', 成都: 'CTU', 重庆: 'CKG', 西安: 'XIY', 杭州: 'HGH', 南京: 'NKG', 武汉: 'WUH', 长沙: 'CSX', 青岛: 'TAO', 厦门: 'XMN', 福州: 'FOC', 昆明: 'KMG', 丽江: 'LJG', 香格里拉: 'DIG', 迪庆: 'DIG', 三亚: 'SYX', 海口: 'HAK', 乌鲁木齐: 'URC', 哈尔滨: 'HRB', 沈阳: 'SHE', 大连: 'DLC', 郑州: 'CGO', 天津: 'TSN', 济南: 'TNA', 桂林: 'KWL', 南宁: 'NNG', 宁波: 'NGB', 温州: 'WNZ', 合肥: 'HFE', 佛山: 'FUO'
});

// 携程的机票与列车查询都以“城市”为粒度，但行程目的地经常是市辖区或县级市。
// 这些地方本身没有铁路枢纽站，需要先归一到最近的枢纽城市再查询，
// 否则会出现“无票”的假阴性。映射只影响查询用的城市名，展示仍使用用户输入的原始地名。
export const TRANSPORT_CITY_ALIASES = Object.freeze({
  顺德: '佛山', 南海: '佛山', 禅城: '佛山', 三水: '佛山', 高明: '佛山',
  番禺: '广州', 花都: '广州', 增城: '广州', 从化: '广州', 南沙: '广州',
  龙岗: '深圳', 宝安: '深圳', 龙华: '深圳', 坪山: '深圳', 光明: '深圳',
  斗门: '珠海', 香洲: '珠海', 金湾: '珠海', 横琴: '珠海',
  新会: '江门', 蓬江: '江门', 江海: '江门',
  大良: '佛山', 容桂: '佛山', 北滘: '佛山', 陈村: '佛山', 乐从: '佛山', 均安: '佛山', 杏坛: '佛山', 龙江: '佛山', 勒流: '佛山', 伦教: '佛山'
});

/** 把市辖区 / 县级市归一到携程可查询的枢纽城市；未登记时原样返回。 */
export function resolveTransportCity(city) {
  const name = String(city || '').trim();
  return TRANSPORT_CITY_ALIASES[name] || name;
}

/** 目的地与查询枢纽不一致时，返回一段可展示的说明；一致时返回 null。 */
export function describeTransportCity(destination, hub) {
  const name = String(destination || '').trim(); const resolved = String(hub || '').trim();
  if (!name || !resolved || name === resolved) return null;
  return `${name}没有直达铁路枢纽，携程查询按最近枢纽城市“${resolved}”进行，抵达后需换乘城际或地铁前往${name}。`;
}

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
