import fs from 'fs';
import readline from 'readline';
import path from 'path';

export interface UrlMetrics {
  count: number;
  totalRt: number;
  maxRt: number;
  maxTps: number; // URL별 최대 TPS 추가
}

export interface LogResponse {
  hourlyStats: {
    [hour: string]: {
      urls: { [url: string]: { count: number; avgRt: number; maxRt: number; maxTps: number } };
      userCount: number;
      avgTps: number;
      maxTps: number;
    };
  };
  timeRange: { start: string; end: string; };
}

const STATIC_EXTENSIONS = [
  '.css', '.js', '.png', '.jpg', '.jpeg', '.gif', '.ico', '.svg',
  '.html', '.htm', '.txt', '.woff', '.woff2', '.ttf', '.eot', '.map'
];

const LOG_REGEX = /^(\S+) (\S+) (\S+) \[([\w:/]+\s[+\-]\d{4})\] "(\S+)\s?([^"]+)?\s?([^"]+)?" (\d{3}|-) (\d+|-)(?:\s+(\d+))?/;

export async function parseLogFile(filePath: string, includeStatic: boolean = false): Promise<LogResponse> {
  // URL별 초당 호출수 추적을 위한 임시 맵
  const urlPerSecondTracker: { [key: string]: number } = {};
  const hourlyRawData: { 
    [hour: string]: { 
      urls: { [url: string]: UrlMetrics }; 
      uniqueIps: Set<string>;
      perSecondCounts: { [second: string]: number };
    } 
  } = {};
  
  if (!fs.existsSync(filePath)) return { hourlyStats: {}, timeRange: { start: '', end: '' } };

  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  for await (const line of rl) {
    if (!line.trim()) continue;
    const match = line.match(LOG_REGEX);
    if (!match) continue;

    const ip = match[1]!;
    const timestamp = match[4]!;
    const fullRequest = match[6] || '/';
    const url = fullRequest.split('?')[0]?.split(' ')[0] || '/';
    const rt = match[10] ? parseInt(match[10], 10) : 0;

    if (!includeStatic) {
      const ext = path.extname(url).toLowerCase();
      if (STATIC_EXTENSIONS.includes(ext)) continue;
    }

    const parts = timestamp.split(':');
    const dStr = parts[0]!;
    const hStr = parts[1]!;
    const mStr = parts[2]!;
    const sStr = parts[3]!.split(' ')[0]!;
    
    const monMap: { [k: string]: string } = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };
    const dPs = dStr.split('/');
    const hourKey = `${dPs[2]}-${monMap[dPs[1]!]}-${dPs[0]} ${hStr}:00`;
    const secondKey = `${hStr}:${mStr}:${sStr}`;
    const urlSecondKey = `${url}_${secondKey}`;

    if (!hourlyRawData[hourKey]) {
      hourlyRawData[hourKey] = { urls: {}, uniqueIps: new Set(), perSecondCounts: {} };
    }

    const hData = hourlyRawData[hourKey]!;
    if (!hData.urls[url]) {
      hData.urls[url] = { count: 0, totalRt: 0, maxRt: 0, maxTps: 0 };
    }
    
    hData.urls[url]!.count += 1;
    hData.urls[url]!.totalRt += rt;
    if (rt > hData.urls[url]!.maxRt) hData.urls[url]!.maxRt = rt;
    
    // URL별 Peak TPS 추적
    urlPerSecondTracker[urlSecondKey] = (urlPerSecondTracker[urlSecondKey] || 0) + 1;
    if (urlPerSecondTracker[urlSecondKey]! > hData.urls[url]!.maxTps) {
      hData.urls[url]!.maxTps = urlPerSecondTracker[urlSecondKey]!;
    }

    hData.uniqueIps.add(ip);
    hData.perSecondCounts[secondKey] = (hData.perSecondCounts[secondKey] || 0) + 1;
  }

  const sortedHours = Object.keys(hourlyRawData).sort();
  const result: LogResponse = { 
    hourlyStats: {}, 
    timeRange: { start: sortedHours[0] || '', end: sortedHours[sortedHours.length - 1] || '' } 
  };

  for (const hour in hourlyRawData) {
    const raw = hourlyRawData[hour]!;
    const totalRequests = Object.values(raw.urls).reduce((acc, curr) => acc + curr.count, 0);
    const maxTps = Math.max(...Object.values(raw.perSecondCounts), 0);
    const avgTps = parseFloat((totalRequests / 3600).toFixed(4));

    result.hourlyStats[hour] = { userCount: raw.uniqueIps.size, avgTps, maxTps, urls: {} };

    for (const url in raw.urls) {
      const m = raw.urls[url]!;
      result.hourlyStats[hour]!.urls[url] = {
        count: m.count,
        avgRt: Math.round(m.totalRt / m.count),
        maxRt: m.maxRt,
        maxTps: m.maxTps
      };
    }
  }

  return result;
}
