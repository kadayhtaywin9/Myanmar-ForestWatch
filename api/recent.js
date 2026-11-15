import { readFile } from 'node:fs/promises';
import { PRODUCTS, bounds, normalize, assemble } from '../lib/nrt.mjs';

async function fetchProduct(product, forests, area, windows, key) {
  const last_attempt = new Date().toISOString();
  try {
    const batches = await Promise.all(windows.map(async ({ days, date }) => {
      const suffix = date ? `/${date}` : '';
      const url = new URL(`https://firms.modaps.eosdis.nasa.gov/api/area/csv/${encodeURIComponent(key)}/${product}/${area}/${days}${suffix}`);
      const response = await fetch(url, { signal: AbortSignal.timeout(25000) });
      if (!response.ok) throw Error('Feed unavailable');
      return normalize(await response.text(), product, forests);
    }));
    const rows = [...new Map(batches.flat().map(row => [row.id, row])).values()];
    return { rows, last_attempt, last_success: new Date().toISOString() };
  } catch {
    return { rows: [], last_attempt, error: 'Unable to retrieve this FIRMS feed' };
  }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const hours = Number(req.query?.hours ?? 24);
  if (![24, 48, 168].includes(hours)) return res.status(400).json({ error: 'Invalid observation window' });
  const key = process.env.FIRMS_MAP_KEY?.trim();
  if (!key) return res.status(503).json({ error: 'Configure FIRMS_MAP_KEY on the server' });
  try {
    const forests = JSON.parse(await readFile(new URL('../public/data/reserved-forests.geojson', import.meta.url), 'utf8'));
    const area = bounds(forests);
    const days = hours / 24 + 1;
    const windows = [{ days: Math.min(days, 5) }];
    if (days > 5) {
      const oldest = new Date();
      oldest.setUTCDate(oldest.getUTCDate() - (days - 1));
      windows.push({ days: days - 5, date: oldest.toISOString().slice(0, 10) });
    }
    const snapshots = await Promise.all(PRODUCTS.map(product => fetchProduct(product, forests, area, windows, key)));
    const result = assemble(snapshots, hours);
    return res.status(result.initialized ? 200 : 502).json(result);
  } catch {
    return res.status(503).json({ error: 'Monitoring service unavailable' });
  }
}
