import React from 'react';
import KPICard from './components/KPICard';
import ChartCard from './components/ChartCard';
import { API_BASE } from './lib/config';

export const runtime = 'edge';

async function fetchJSON(path: string) {
  const url = API_BASE ? `${API_BASE}${path}` : path;
  const res = await fetch(url, { cache: 'no-store' }).catch(() => null);
  if (res && res.ok) return res.json();
  // Fallback to local public data
  const local = await fetch(`/data${path.replace('/api','')}`).catch(() => null);
  return local?.ok ? local.json() : null;
}

export default async function Page() {
  const league = await fetchJSON('/api/league') as any[] | null; // [{area, property_sub_type, net_yield, price_to_rent, ...}]
  const rentPpm2 = await fetchJSON('/api/rent_ppm2') as any[] | null; // [{period, area, property_sub_type, median_rent_ppm2}]
  const ptr = await fetchJSON('/api/ptr') as any[] | null; // [{period, area, property_sub_type, price_to_rent}]

  const firstLeague = league?.[0];
  const kpiNetYield = firstLeague?.net_yield ? (firstLeague.net_yield * 100).toFixed(2) : '—';
  const kpiPtr = firstLeague?.price_to_rent ? firstLeague.price_to_rent.toFixed(1) : '—';

  // Build simple timeseries for the first area/subtype
  const firstKey = rentPpm2?.[0]?.area && rentPpm2?.[0]?.property_sub_type
    ? { area: rentPpm2[0].area, sub: rentPpm2[0].property_sub_type } : null;

  const rentCat: string[] = [];
  const rentData: number[] = [];
  if (firstKey) {
    (rentPpm2 as any[])
      .filter((r: any) => r.area === firstKey.area && r.property_sub_type === firstKey.sub)
      .slice(0, 24)
      .forEach((r: any) => { rentCat.push(r.period.slice(0,7)); rentData.push(r.median_rent_ppm2); });
  }

  const ptrCat: string[] = [];
  const ptrData: number[] = [];
  if (firstKey) {
    (ptr as any[])
      .filter((p: any) => p.area === firstKey.area && p.property_sub_type === firstKey.sub)
      .slice(0, 24)
      .forEach((p: any) => { ptrCat.push(p.period.slice(0,7)); ptrData.push(p.price_to_rent); });
  }

  return (
    <main className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPICard label="Top Net Yield (sample)" value={kpiNetYield} suffix="%" />
        <KPICard label="Top Price-to-Rent (years)" value={kpiPtr} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <ChartCard title="Rent per m² (AED) — sample" categories={rentCat} series={[{ name: 'Rent/m²', data: rentData }]} />
        <ChartCard title="Price-to-Rent (years) — sample" categories={ptrCat} series={[{ name: 'P/R', data: ptrData }]} />
      </div>

      <section className="rounded-2xl bg-white dark:bg-slate-800 p-4 shadow">
        <h2 className="text-lg font-semibold mb-3">Community League Table (sample)</h2>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left text-slate-600 dark:text-slate-400">
              <tr>
                <th className="py-2 pr-4">Area</th>
                <th className="py-2 pr-4">Subtype</th>
                <th className="py-2 pr-4">Net Yield</th>
                <th className="py-2 pr-4">Price-to-Rent</th>
                <th className="py-2 pr-4">Off-plan Premium</th>
                <th className="py-2 pr-4">Turnover</th>
              </tr>
            </thead>
            <tbody>
              {(league || []).slice(0, 20).map((row: any, i: number) => (
                <tr key={i} className="border-t border-slate-200 dark:border-slate-700">
                  <td className="py-2 pr-4">{row.area}</td>
                  <td className="py-2 pr-4">{row.property_sub_type}</td>
                  <td className="py-2 pr-4">{(row.net_yield*100).toFixed(2)}%</td>
                  <td className="py-2 pr-4">{row.price_to_rent?.toFixed(1)}</td>
                  <td className="py-2 pr-4">{row.offplan_premium != null ? (row.offplan_premium*100).toFixed(1)+'%' : '—'}</td>
                  <td className="py-2 pr-4">{row.turnover_velocity != null ? row.turnover_velocity.toFixed(2) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
