import { and, eq, gte, sql } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { requireSession } from "@/server/session";
import { formatDateTime, formatUnitPrice } from "@/lib/format";
import { Card, PageHeader, Notice } from "@/components/ui";
import type { FuelCode } from "@/domain/types";
import { E85Simulator, TcoSimulator } from "@/components/forms/simulator";

export const metadata = { title: "Simulations" };

async function recentAverage(fuel: FuelCode) {
  const since = new Date(Date.now() - 72 * 3_600_000);
  const [r] = await getDb()
    .select({ avg: sql<string | null>`avg(${schema.priceObservations.price})`, n: sql<number>`count(*)::int`, last: sql<Date | null>`max(${schema.priceObservations.observedAt})` })
    .from(schema.priceObservations)
    .innerJoin(schema.stations, eq(schema.stations.id, schema.priceObservations.stationId))
    .where(and(eq(schema.priceObservations.fuel, fuel), eq(schema.priceObservations.quality, "officielle"), eq(schema.stations.isDemo, false), gte(schema.priceObservations.observedAt, since)));
  if (!r?.avg || !r.n) return null;
  const v = Number(r.avg).toFixed(3);
  return { value: v.replace(".", ","), label: `Moyenne de ${r.n} relevé(s) officiel(s) ≤ 72 h, dernier le ${formatDateTime(new Date(r.last!))} : ${formatUnitPrice(v)}` };
}

export default async function Simulations({ searchParams }: { searchParams: Promise<{ modele?: string }> }) {
  const q = await searchParams;
  await requireSession();
  const [gp, ep] = await Promise.all([recentAverage("SP95_E10"), recentAverage("E85")]);
  const captur = q.modele === "captur";
  return (
    <div className="space-y-4">
      <PageHeader title="Simulations" subtitle="Estimations avant achat ou conversion. Elles ne sont jamais présentées comme des mesures." />
      {captur && <Notice tone="info" title="Modèle « Captur essence envisagé »">Hypothèses préremplies : essence 6 L/100 km, E85 +25 % jusqu&apos;aux mesures, conversion hypothétique 360 €, 25 000 km/an. Les prix sont à saisir ou chargés depuis des relevés datés. Aucun achat n&apos;est enregistré.</Notice>}
      <Card title="Conversion E85 : coût au km et amortissement">
        <E85Simulator defaults={captur ? { l100: "6", over: "25", conv: "360", km: "25000" } : { l100: "", over: "25", conv: "", km: "" }} gasolinePrice={gp} e85Price={ep} />
        <p className="mt-3 text-xs text-muted">Une conversion ou reprogrammation déclarée ne vaut pas homologation. Vérifiez la conformité et l&apos;assurance auprès de professionnels.</p>
      </Card>
      <Card title="Comparer des énergies (coût total de possession)">
        <TcoSimulator />
      </Card>
    </div>
  );
}
