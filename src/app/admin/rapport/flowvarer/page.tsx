"use client";

import { Download, Filter, RefreshCw } from "lucide-react";
import { Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AppShell } from "@/components/backevent/app-shell";
import { Header } from "@/components/backevent/header";
import { Button, Notice } from "@/components/backevent/ui";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type Option = { id: string; name: string; active: boolean };
type Report = { ok: boolean; message?: string; canSeeDiagnostics: boolean; summary: Record<string, number>; locations: Option[]; products: Option[]; rows: Array<{ productId: string; productName: string; consumptionUnit: string; gross: number; returned: number; net: number; waste: number; humanGross: string; humanReturned: string; humanNet: string; humanWaste: string; lineCount: number; latestAt: string; byLocation: Record<string, number>; details: Array<Record<string, unknown>> }> };

export default function FlowvarerPage() {
  return <Suspense fallback={<AppShell requiredRole="ansvarlig"><Notice tone="pending">Henter flowvarerapport…</Notice></AppShell>}><FlowvarerContent /></Suspense>;
}

function FlowvarerContent() {
  const search = useSearchParams(); const router = useRouter();
  const initial = useMemo(() => initialInterval(search), [search]);
  const [from, setFrom] = useState(initial.from); const [to, setTo] = useState(initial.to);
  const [locations, setLocations] = useState<string[]>(search.getAll("location")); const [products, setProducts] = useState<string[]>(search.getAll("product"));
  const [includeInactive, setIncludeInactive] = useState(search.get("historical") === "1"); const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true); const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState("net");

  async function load(nextFrom = from, nextTo = to) {
    try { setLoading(true); setError(null); const params = paramsFor(nextFrom, nextTo, locations, products, includeInactive); router.replace(`?${params}`); setReport(await requestReport(params)); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Rapporten kunne ikke hentes"); } finally { setLoading(false); }
  }
  useEffect(() => {
    const params = paramsFor(initial.from, initial.to, search.getAll("location"), search.getAll("product"), search.get("historical") === "1");
    void requestReport(params).then(setReport).catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Rapporten kunne ikke hentes")).finally(() => setLoading(false));
  }, [initial.from, initial.to, search]);
  const visibleLocations = (report?.locations ?? []).filter((item) => includeInactive || item.active);
  const sortedRows = useMemo(() => [...(report?.rows ?? [])].sort((a, b) => sort === "product" ? a.productName.localeCompare(b.productName, "da") : sort === "gross" ? b.gross - a.gross : sort === "bar" ? Object.keys(b.byLocation).length - Object.keys(a.byLocation).length : b.net - a.net), [report, sort]);
  async function downloadCsv() { try { setError(null); const token = await accessToken(); const params = paramsFor(from, to, locations, products, includeInactive); const response = await fetch(`/api/admin/reports/flowvarer?${params}&format=csv`, { headers: token ? { Authorization: `Bearer ${token}` } : undefined }); if (!response.ok) throw new Error("CSV-eksporten kunne ikke hentes"); const blob = await response.blob(); const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = filenameFromDisposition(response.headers.get("Content-Disposition")) ?? "flowvarer.csv"; link.click(); URL.revokeObjectURL(link.href); } catch (caught) { setError(caught instanceof Error ? caught.message : "CSV-eksporten kunne ikke hentes"); } }
  return <AppShell requiredRole="ansvarlig"><Header title="Afsætning af flowvarer" subtitle="Faktisk OnlinePOS-forbrug, returer og nettoafsætning" />
    <section className="sticky top-2 z-20 mb-5 rounded-2xl border border-line bg-macro/95 p-4 shadow-sm backdrop-blur">
      <div className="mb-3 flex items-center gap-2 font-bold"><Filter className="h-4 w-4" />Filtre</div>
      <div className="grid gap-3 md:grid-cols-4"><Field label="Fra"><input className="field" type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} /></Field><Field label="Til"><input className="field" type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        <Multi label="Bar/lokation" options={visibleLocations} selected={locations} setSelected={setLocations} /><Multi label="Produkter" options={report?.products ?? []} selected={products} setSelected={setProducts} /></div>
      <label className="mt-2 flex items-center gap-2 text-sm font-bold"><input type="checkbox" checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} />Vis historiske/inaktive barer</label>
      <div className="mt-3 flex flex-wrap gap-2">{["Seneste time","I dag","I går","Hele markedet"].map((label) => <Button key={label} type="button" tone="secondary" onClick={() => { const range = quickRange(label); setFrom(range.from); setTo(range.to); }}>{label}</Button>)}<Button type="button" onClick={() => void load()} disabled={loading}><RefreshCw className="h-4 w-4" />{loading ? "Henter…" : "Vis rapport"}</Button><Button type="button" tone="secondary" onClick={() => void downloadCsv()}><Download className="h-4 w-4" />CSV</Button></div>
      <div className="mt-2 flex flex-wrap gap-1">{locations.map((id) => <span key={id} className="rounded-full bg-pantone139/30 px-2 py-1 text-xs font-bold">{report?.locations.find((item) => item.id === id)?.name ?? id}</span>)}</div>
    </section>
    {error ? <Notice tone="danger" className="mb-4">{error}</Notice> : null}
    {report ? <><div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">{[["Behandlede boner",report.summary.receiptCount],["Salgslinjer",report.summary.processedLineCount],["Forbrugsenheder",report.summary.totalConsumptionUnits],["Dubletter",report.summary.duplicateCount],["Ignorerede",report.summary.ignoredLineCount],["Kontrol/mapping",report.summary.controlOrMappingLineCount]].map(([label,value]) => <Metric key={String(label)} label={String(label)} value={Number(value)} />)}</div>
      {report.rows.length ? <><div className="mb-3 flex justify-end"><label className="text-sm font-bold">Sortér <select className="field ml-2" value={sort} onChange={(event) => setSort(event.target.value)}><option value="net">Højeste nettoafsætning</option><option value="gross">Højeste bruttoafsætning</option><option value="product">Produkt</option><option value="bar">Antal barer</option></select></label></div><div className="space-y-3">{sortedRows.map((row) => <details key={row.productId} className="rounded-2xl border border-line bg-macro p-4"><summary className="cursor-pointer font-bold">{row.productName} · Netto {row.humanNet}</summary><div className="mt-3 grid gap-2 sm:grid-cols-4"><Small label="Brutto" value={row.humanGross}/><Small label="Retur" value={row.humanReturned}/><Small label="Netto" value={row.humanNet}/><Small label="Svind" value={row.humanWaste}/></div><p className="mt-2 text-xs font-bold text-muted">{row.lineCount} linjer · Seneste {new Date(row.latestAt).toLocaleString("da-DK")}</p><div className="mt-2 flex flex-wrap gap-1">{Object.entries(row.byLocation).map(([locationId, amount]) => <span className="rounded-full bg-soft px-2 py-1 text-xs" key={locationId}>{report.locations.find((item) => item.id === locationId)?.name ?? locationId}: {formatNumber(amount)}</span>)}</div><div className="mt-3 overflow-x-auto"><table className="min-w-full text-left text-xs"><thead><tr>{["Tid","Bar","Bon","OnlinePOS-produkt","Solgt","Forbrug/salg","Samlet","Kilde","Status",...(report.canSeeDiagnostics?["RPC-delta"]:[])].map((h)=><th className="p-2" key={h}>{h}</th>)}</tr></thead><tbody>{row.details.map((d,i)=><tr className="border-t border-line" key={i}>{[new Date(String(d.datetime)).toLocaleString("da-DK"),report.locations.find((l)=>l.id===d.locationId)?.name??"-",d.receiptNumber,d.onlineposProductName,d.soldQuantity,d.consumptionPerSale,d.totalConsumption,d.source,d.status,...(report.canSeeDiagnostics?[d.storedDelta]:[])].map((v,j)=><td className="p-2" key={j}>{typeof v === "number" ? formatNumber(v) : String(v??"-")}</td>)}</tr>)}</tbody></table></div></details>)}</div></>:<Notice tone="pending">Ingen faktisk behandlede flowvarelinjer i intervallet.</Notice>}</>:null}
  </AppShell>;
}

function Multi({label,options,selected,setSelected}:{label:string;options:Option[];selected:string[];setSelected:(v:string[])=>void}) { return <details className="relative"><summary className="field cursor-pointer">{label}: {selected.length||"Alle"}</summary><div className="absolute z-30 mt-1 max-h-72 w-full min-w-64 overflow-auto rounded-xl border border-line bg-macro p-3 shadow-xl"><div className="mb-2 flex gap-2"><button className="text-xs font-bold underline" onClick={()=>setSelected(options.map(o=>o.id))}>Vælg alle</button><button className="text-xs font-bold underline" onClick={()=>setSelected([])}>Ryd valg</button></div>{options.map(o=><label className="flex gap-2 py-1 text-sm" key={o.id}><input type="checkbox" checked={selected.includes(o.id)} onChange={()=>setSelected(selected.includes(o.id)?selected.filter(id=>id!==o.id):[...selected,o.id])}/>{o.name}{!o.active?" (inaktiv)":""}</label>)}</div></details>; }
function Field({label,children}:{label:string;children:ReactNode}) { return <label><span className="mb-1 block text-xs font-bold uppercase text-muted">{label}</span>{children}</label>; }
function Metric({label,value}:{label:string;value:number}) { return <div className="rounded-xl bg-soft p-3"><p className="text-xs font-bold uppercase text-muted">{label}</p><p className="text-xl font-bold">{new Intl.NumberFormat("da-DK",{maximumFractionDigits:2}).format(value)}</p></div>; }
function Small({label,value}:{label:string;value:string}) { return <div><p className="text-xs font-bold text-muted">{label}</p><p className="font-bold">{value}</p></div>; }
function paramsFor(from:string,to:string,locations:string[],products:string[],historical:boolean) { const p=new URLSearchParams({from:new Date(from).toISOString(),to:new Date(to).toISOString()}); locations.forEach(v=>p.append("location",v)); products.forEach(v=>p.append("product",v)); if(historical)p.set("historical","1"); return p.toString(); }
function initialInterval(search:URLSearchParams) { const now=new Date(); const before=new Date(now.getTime()-3600000); return {from:localValue(search.get("from")?new Date(search.get("from")!):before),to:localValue(search.get("to")?new Date(search.get("to")!):now)}; }
function quickRange(label:string) { const now=new Date(); let from=new Date(now); let to=new Date(now); if(label==="Seneste time")from=new Date(now.getTime()-3600000); else if(label==="I dag")from=new Date(now.getFullYear(),now.getMonth(),now.getDate()); else if(label==="I går"){from=new Date(now.getFullYear(),now.getMonth(),now.getDate()-1);to=new Date(now.getFullYear(),now.getMonth(),now.getDate());} else {from=new Date("2025-07-01T00:00:00");} return {from:localValue(from),to:localValue(to)}; }
function localValue(date:Date){const copy=new Date(date.getTime()-date.getTimezoneOffset()*60000);return copy.toISOString().slice(0,16);}
async function accessToken(){const client=createSupabaseBrowserClient();if(!client)return null;return (await client.auth.getSession()).data.session?.access_token??null;}
async function requestReport(params:string){const token=await accessToken();const response=await fetch(`/api/admin/reports/flowvarer?${params}`,{headers:token?{Authorization:`Bearer ${token}`}:undefined});const data=await response.json() as Report;if(!response.ok||!data.ok)throw new Error(data.message??"Rapporten kunne ikke hentes");return data;}
function filenameFromDisposition(value:string|null){return value?.match(/filename="([^"]+)"/)?.[1]??null;}
function formatNumber(value:number){return new Intl.NumberFormat("da-DK",{maximumFractionDigits:3}).format(value);}
