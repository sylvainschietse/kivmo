import { Suspense } from "react";
import { stationTitle } from "@/integrations/station-names";
import { StationsMap, type MapPoint } from "@/components/stations-map";
import { getDb } from "@/db/client";
import { requireSession } from "@/server/session";
import { favoriteStations, nearbyStations, searchStationsByText } from "@/server/services/stations";
import { activeSponsoredOffers } from "@/server/services/partners";
import { integrations } from "@/integrations/registry";
import { lastImport, refreshAreaIfStale } from "@/integrations/fuel-prices";
import { formatDateTime } from "@/lib/format";
import { FUEL_LABELS, FUELS, type FuelCode } from "@/domain/types";
import { Button, Card, EmptyState, ErrorFromQuery, Field, Input, IntegrationPill, Notice, OkFromQuery, PageHeader, Select } from "@/components/ui";
import { LocateButton } from "@/components/locate-button";
import { StationCard } from "@/components/station-card";

export const metadata = { title: "Stations" };

type Q = { lat?: string; lng?: string; precision?: string; q?: string; fuel?: string; rayon?: string; age?: string; rupture?: string; ouvert?: string; marque?: string; service?: string; ok?: string; erreur?: string };

export default async function Stations({ searchParams }: { searchParams: Promise<Q> }) {
  const q = await searchParams;
  const { ctx } = await requireSession();
  const db = getDb();
  const fuel = (FUELS as readonly string[]).includes(q.fuel ?? "") ? (q.fuel as FuelCode) : null;
  const lat = q.lat ? Number(q.lat) : NaN, lng = q.lng ? Number(q.lng) : NaN;
  const hasPos = Number.isFinite(lat) && Number.isFinite(lng);
  const includeDemo = ctx.isDemo;
  // Prix officiels de la zone rafraîchis à la demande s'ils datent de plus de 3 h (sans bloquer en cas d'échec).
  if (hasPos && !includeDemo) await refreshAreaIfStale(db, lat, lng, Number(q.rayon ?? 10) || 10).catch(() => undefined);
  const results = hasPos
    ? await nearbyStations(db, ctx, { lat, lng, radiusKm: Number(q.rayon ?? 10) || 10, fuel, maxPriceAgeHours: q.age ? Number(q.age) : null, excludeRupture: q.rupture === "1", openNow: q.ouvert === "1", brand: q.marque || null, service: q.service || null, includeDemo, limit: 30 })
    : q.q
      ? await searchStationsByText(db, ctx, q.q, includeDemo)
      : null;
  const favorites = results ? [] : await favoriteStations(db, ctx);
  const offers = await activeSponsoredOffers(db, includeDemo);
  const map = integrations().find((i) => i.key === "map_tiles");
  const prices = integrations().find((i) => i.key === "fuel_prices");
  const imp = await lastImport(db);
  const precision = q.precision ? Number(q.precision) : null;
  const priceFmt = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", minimumFractionDigits: 3, maximumFractionDigits: 3 });
  const kmFmt = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });
  const bestPrice = fuel && results ? Math.min(...results.map((v) => { const f = v.fuels.find((x) => x.fuel === fuel); return f?.price && !f.stale ? f.price.toNumber() : Infinity; })) : Infinity;
  const points: MapPoint[] = (results ?? []).map((v) => {
    const f = fuel ? v.fuels.find((x) => x.fuel === fuel) : undefined;
    const price = f?.price ? f.price.toNumber() : null;
    return {
      id: v.station.id,
      lat: v.station.lat,
      lng: v.station.lng,
      name: stationTitle(v.station),
      brand: v.station.brand && v.station.brand !== v.station.name ? v.station.brand : null,
      price: price !== null ? priceFmt.format(price) : null,
      stale: f?.stale ?? false,
      priceDate: f?.observedAt ? formatDateTime(f.observedAt) : null,
      distance: v.crowFliesKm !== null ? `${kmFmt.format(v.crowFliesKm)} km` : null,
      best: price !== null && price === bestPrice,
    };
  });

  return (
    <div className="space-y-4">
      <PageHeader title="Stations" subtitle="Prix officiels datés, classés par prix puis distance. Aucun classement payant." />
      <OkFromQuery ok={q.ok} />
      <ErrorFromQuery error={q.erreur} />
      <Card>
        <div className="flex flex-wrap items-start gap-3">
          <Suspense><LocateButton /></Suspense>
          <form className="flex min-w-0 flex-1 gap-2" role="search">
            <label htmlFor="q" className="sr-only">Ville, code postal ou adresse</label>
            <Input id="q" name="q" type="search" placeholder="Ville, code postal, adresse" defaultValue={q.q} className="min-w-0 flex-1" />
            {fuel && <input type="hidden" name="fuel" value={fuel} />}
            <Button type="submit" variant="secondary">Chercher</Button>
          </form>
        </div>
        <details className="mt-3" open={!!(q.fuel || q.age || q.rupture || q.ouvert || q.marque)}>
          <summary className="tap cursor-pointer text-sm font-semibold text-green">Filtres</summary>
          <form className="mt-2 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {hasPos && <><input type="hidden" name="lat" value={q.lat} /><input type="hidden" name="lng" value={q.lng} /></>}
            {q.q && <input type="hidden" name="q" value={q.q} />}
            <Field label="Carburant" htmlFor="fuel"><Select id="fuel" name="fuel" defaultValue={fuel ?? ""}><option value="">Tous</option>{FUELS.filter((f) => f !== "ELEC_KWH").map((f) => <option key={f} value={f}>{FUEL_LABELS[f]}</option>)}</Select></Field>
            <Field label="Rayon" htmlFor="rayon"><Select id="rayon" name="rayon" defaultValue={q.rayon ?? "10"}>{[2, 5, 10, 20, 50].map((r) => <option key={r} value={r}>{r} km</option>)}</Select></Field>
            <Field label="Prix de moins de" htmlFor="age"><Select id="age" name="age" defaultValue={q.age ?? ""}><option value="">Peu importe</option><option value="24">24 h</option><option value="48">48 h</option><option value="168">7 jours</option></Select></Field>
            <Field label="Marque" htmlFor="marque"><Input id="marque" name="marque" defaultValue={q.marque} /></Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="rupture" value="1" defaultChecked={q.rupture === "1"} className="h-5 w-5" /> Exclure les ruptures signalées</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="ouvert" value="1" defaultChecked={q.ouvert === "1"} className="h-5 w-5" /> Ouvert 24 h/24</label>
            <div><Button type="submit">Appliquer</Button></div>
          </form>
        </details>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted">
          {prices && <span>Prix : <IntegrationPill status={prices.status} /></span>}
          {imp?.lastSuccessAt ? <span>Dernier import réussi : {formatDateTime(imp.lastSuccessAt)}</span> : <span>Aucun import de prix réussi.</span>}{imp?.lastError && <span className="text-warn">Dernière erreur : {imp.lastError}</span>}
          {map && <span>Carte : <IntegrationPill status={map.status} /></span>}
        </div>
      </Card>

      {hasPos && precision && precision > 1000 && <Notice tone="warn">Position approximative (± {Math.round(precision / 1000)} km) : les distances sont indicatives.</Notice>}

      {results ? (
        results.length ? (
          <section aria-label="Résultats">
            <StationsMap points={points} center={hasPos ? { lat, lng } : null} fuelLabel={fuel ? FUEL_LABELS[fuel] : null} />
            {!fuel && <p className="mt-2 text-xs text-muted">Choisissez un carburant dans les filtres pour afficher son prix sur la carte.</p>}
            <h2 className="mb-2 mt-3 text-sm font-semibold text-muted">{results.length} station(s){fuel ? ` proposant ${FUEL_LABELS[fuel]}` : ""}</h2>
            <ul className="space-y-2">{results.map((v, i) => <li key={v.station.id}><StationCard v={v} fuel={fuel} rank={fuel ? i + 1 : undefined} /></li>)}</ul>
          </section>
        ) : (
          <EmptyState title="Aucune station trouvée">Élargissez le rayon ou retirez des filtres. Si aucun import de prix n&apos;a eu lieu, la base de stations est vide.</EmptyState>
        )
      ) : (
        <section aria-label="Favoris">
          <h2 className="mb-2 text-sm font-semibold text-muted">Stations favorites</h2>
          {favorites.length ? <ul className="space-y-2">{favorites.map((v) => <li key={v.station.id}><StationCard v={v} /></li>)}</ul> : <p className="text-sm text-muted">Aucun favori. Cherchez une station puis ajoutez-la depuis sa fiche.</p>}
        </section>
      )}

      {offers.length > 0 && (
        <section aria-label="Offres sponsorisées" className="rounded-2xl border border-dashed border-line p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Sponsorisé · séparé du classement</p>
          <ul className="mt-2 space-y-2">{offers.map((o) => <li key={o.id} className="text-sm"><strong>{o.title}</strong> · {o.body} {o.isDemo && "(démonstration)"}</li>)}</ul>
        </section>
      )}
    </div>
  );
}
