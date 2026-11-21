import Link from "next/link";
import { BackButton } from "@/components/back-button";
import { stationTitle } from "@/integrations/station-names";
import { getDb } from "@/db/client";
import { requireSession } from "@/server/session";
import { navigationUrl, stationDetail, AVAILABILITY_LABELS } from "@/server/services/stations";
import { AppError } from "@/server/errors";
import { formatAge, formatDateTime, formatUnitPrice } from "@/lib/format";
import { FUEL_LABELS, type FuelCode } from "@/domain/types";
import { Badge, Button, Card, EmptyState, ErrorFromQuery, Field, Input, LinkButton, OkFromQuery, PageHeader, Select, Table } from "@/components/ui";
import { reportStationAction, toggleFavoriteAction } from "@/app/actions/stations";

const KIND: Record<string, string> = { rupture: "Rupture", disponible: "Disponible", prix: "Prix constaté", fermeture: "Station fermée" };

export default async function StationPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; erreur?: string }> }) {
  const { id } = await params;
  const q = await searchParams;
  const { ctx } = await requireSession();
  let s;
  try {
    s = await stationDetail(getDb(), ctx, id, null);
  } catch (e) {
    if (e instanceof AppError) return <EmptyState title="Station introuvable" />;
    throw e;
  }
  const st = s.station;
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <BackButton fallback="/stations" />
      <PageHeader title={stationTitle(st)} subtitle={[st.address, st.postalCode, st.city].filter(Boolean).join(" ")} />
      <OkFromQuery ok={q.ok} />
      <ErrorFromQuery error={q.erreur} />
      {st.brand && st.brand !== st.name && <p className="text-sm font-semibold text-muted">Enseigne : {st.brand}</p>}
      {!st.isDemo && (st.name || st.brand) && <p className="text-xs text-muted">Nom et enseigne : © les contributeurs d&apos;OpenStreetMap</p>}
      {st.isDemo && <Badge tone="lime">Station de démonstration (données fictives)</Badge>}
      <div className="flex flex-wrap gap-2">
        <LinkButton href={`/pleins/nouveau?station=${st.id}`} variant="lime">Ajouter un plein ici</LinkButton>
        <form action={toggleFavoriteAction}><input type="hidden" name="stationId" value={st.id} /><input type="hidden" name="back" value={`/stations/${st.id}`} /><Button type="submit" variant="secondary">{s.isFavorite ? "Retirer des favoris" : "Ajouter aux favoris"}</Button></form>
      </div>
      <Card title="Itinéraire">
        <p className="mb-2 text-sm text-muted">La navigation guidée est confiée à l&apos;application de votre choix.</p>
        <div className="flex flex-wrap gap-2">
          {[["google", "Google Maps"], ["waze", "Waze"], ["apple", "Plans (Apple)"], ["osm", "OpenStreetMap"]].map(([k, l]) => (
            <a key={k} href={navigationUrl(k, st.lat, st.lng)} target="_blank" rel="noreferrer" className="tap inline-flex items-center rounded-xl bg-surface-2 px-3 text-sm font-semibold">{l}</a>
          ))}
          <Link href={`/trajets?station=${st.id}`} className="tap inline-flex items-center rounded-xl bg-surface-2 px-3 text-sm font-semibold">Ce détour vaut-il le coup ?</Link>
        </div>
      </Card>
      <Card title="Carburants et prix">
        <Table
          head={["Carburant", "Prix officiel", "Relevé", "Disponibilité", "Signalement"]}
          rows={s.fuels.map((f) => [
            FUEL_LABELS[f.fuel],
            f.price ? <strong key="p" className="num">{formatUnitPrice(f.price)}</strong> : "—",
            f.observedAt ? <span key="o" className={f.stale ? "text-warn" : ""}>{formatDateTime(f.observedAt)} ({formatAge(f.observedAt)}){f.source ? ` · ${f.source}` : ""}</span> : "—",
            AVAILABILITY_LABELS[f.availability],
            f.communityPrice ? `${formatUnitPrice(f.communityPrice.price)} signalé ${formatAge(f.communityPrice.at)}` : f.warnings.join(" ") || "—",
          ])}
        />
        <p className="mt-2 text-xs text-muted">Un prix de plus de 48 h est marqué ancien. « Proposé » signifie que la station distribue ce carburant, pas qu&apos;il est disponible maintenant.</p>
      </Card>
      <Card title="Signaler">
        <form action={reportStationAction} className="grid gap-3 sm:grid-cols-4">
          <input type="hidden" name="stationId" value={st.id} />
          <Field label="Type" htmlFor="kind"><Select id="kind" name="kind">{Object.entries(KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
          <Field label="Carburant" htmlFor="fuel"><Select id="fuel" name="fuel"><option value="">—</option>{s.fuels.map((f) => <option key={f.fuel} value={f.fuel}>{FUEL_LABELS[f.fuel]}</option>)}</Select></Field>
          <Field label="Prix constaté (€/L)" htmlFor="reportedPrice"><Input id="reportedPrice" name="reportedPrice" inputMode="decimal" /></Field>
          <div className="flex items-end"><Button type="submit">Envoyer</Button></div>
        </form>
        {s.reports.length > 0 && (
          <ul className="mt-3 space-y-1 text-sm">
            {s.reports.map((r) => <li key={r.id}>{formatDateTime(r.observedAt)} · {KIND[r.kind] ?? r.kind}{r.fuel ? ` ${FUEL_LABELS[r.fuel as FuelCode]}` : ""}{r.reportedPrice ? ` · ${formatUnitPrice(r.reportedPrice)}` : ""} <Badge tone={r.status === "rejete" ? "loss" : "neutral"}>{r.status === "rejete" ? "Rejeté" : r.expiresAt < new Date() ? "Expiré" : "Communautaire"}</Badge></li>)}
          </ul>
        )}
      </Card>
      <Card title="Historique des prix">
        {s.history.length ? <Table head={["Date", "Carburant", "Prix", "Source"]} rows={s.history.map((h) => [formatDateTime(h.observedAt), FUEL_LABELS[h.fuel as FuelCode], formatUnitPrice(h.price), `${h.source} (${h.quality})`])} /> : <p className="text-sm text-muted">Aucun relevé.</p>}
      </Card>
      {(st.services.length > 0 || st.isAlwaysOpen) && <Card title="Services"><p className="text-sm">{st.isAlwaysOpen ? "Ouvert 24 h/24. " : ""}{st.services.join(", ")}</p></Card>}
    </div>
  );
}
