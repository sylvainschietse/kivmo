import { getDb } from "@/db/client";
import { requireSession } from "@/server/session";
import { homeData } from "@/server/services/dashboard";
import { stationDetail } from "@/server/services/stations";
import { integrations } from "@/integrations/registry";
import { FUEL_LABELS } from "@/domain/types";
import { Card, IntegrationPill, Notice, PageHeader } from "@/components/ui";
import { DetourCalculator, TripPlanner } from "@/components/forms/trip-tools";

export const metadata = { title: "Trajets et détours" };

export default async function Trajets({ searchParams }: { searchParams: Promise<{ station?: string }> }) {
  const q = await searchParams;
  const { ctx } = await requireSession();
  const db = getDb();
  const h = await homeData(db, ctx);
  const s = h.summary;
  const station = q.station && /^[0-9a-f-]{36}$/.test(q.station) ? await stationDetail(db, ctx, q.station, null).catch(() => null) : null;
  const fuelFor = s?.vehicle.energy === "diesel" ? "GAZOLE" : s?.vehicle.energy?.startsWith("e85") ? "E85" : "SP95_E10";
  const sp = station?.fuels.find((f) => f.fuel === fuelFor && f.price && !f.stale);
  const consumption = s?.averageL100 ? s.averageL100.toFixed(1).replace(".", ",") : "";
  const routing = integrations().find((i) => i.key === "routing");
  return (
    <div className="space-y-4">
      <PageHeader title="Trajets et détours" subtitle="Décider si un détour vaut le coup et estimer le carburant d'un voyage." action={routing ? <IntegrationPill status={routing.status} /> : null} />
      {routing?.status === "a_connecter" && <Notice tone="info">Le calcul d&apos;itinéraire routier n&apos;est pas connecté : saisissez les distances (lues dans votre GPS). KIVMO n&apos;invente jamais une distance routière.</Notice>}
      <Card title={station ? `Détour vers ${station.station.name ?? station.station.city}` : "Ce détour vaut-il le coup ?"}>
        {station && <p className="mb-2 text-sm text-muted">{sp ? `Prix ${FUEL_LABELS[sp.fuel]} prérempli depuis le relevé officiel.` : "Aucun prix récent pour votre carburant dans cette station : saisissez-le."}</p>}
        <DetourCalculator defaults={{ detourPrice: sp?.price ? sp.price.toString().replace(".", ",") : "", consumption, volume: s?.vehicle.tankCapacityL ? String(Math.round(Number(s.vehicle.tankCapacityL) * 0.8)) : "" }} />
      </Card>
      <Card title="Préparer un voyage">
        <TripPlanner defaults={{ consumption, tank: s?.vehicle.tankCapacityL ? Number(s.vehicle.tankCapacityL).toString().replace(".", ",") : "", price: "" }} />
      </Card>
    </div>
  );
}
