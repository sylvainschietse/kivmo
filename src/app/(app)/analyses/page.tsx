import { getDb } from "@/db/client";
import { requireSession } from "@/server/session";
import { homeData, vehicleSummary } from "@/server/services/dashboard";
import { AppError } from "@/server/errors";
import { formatConsumption, formatDate, formatKm, formatLiters, formatMoney, formatSignedMoney } from "@/lib/format";
import { ISSUE_MESSAGES } from "@/domain/consumption";
import { BarChart, LineChart } from "@/components/charts";
import { Badge, Card, EmptyState, LinkButton, Notice, PageHeader, Select, Stat, Table, Button } from "@/components/ui";

export const metadata = { title: "Analyses" };

const STATUS: Record<string, [string, "gain" | "warn" | "loss"]> = { measured: ["Mesuré", "gain"], suspect: ["Suspect", "warn"], invalid: ["Exclu", "loss"] };

export default async function Analyses({ searchParams }: { searchParams: Promise<{ vehicleId?: string }> }) {
  const q = await searchParams;
  const { ctx } = await requireSession();
  const db = getDb();
  const h = await homeData(db, ctx);
  const vehicleId = q.vehicleId ?? h.summary?.vehicle.id;
  if (!vehicleId) return <EmptyState title="Aucune donnée" action={<LinkButton href="/onboarding">Ajouter un véhicule</LinkButton>}>Ajoutez un véhicule et deux pleins complets pour obtenir des analyses.</EmptyState>;
  let s;
  try {
    s = await vehicleSummary(db, ctx, vehicleId, h.timeZone);
  } catch (e) {
    if (e instanceof AppError) return <EmptyState title="Véhicule introuvable" />;
    throw e;
  }
  const months = s.monthly.slice(-12);
  const measured = s.intervals.filter((i) => i.status === "measured");
  const last = measured.at(-1);
  const drift = last && s.averageL100 && measured.length >= 3 && last.consumptionL100!.gt(s.averageL100.times(1.15));

  return (
    <div className="space-y-4">
      <PageHeader title="Analyses" subtitle={`${s.vehicle.name} · ${s.headline}`} />
      {h.vehicles.length > 1 && (
        <form className="flex gap-2"><label htmlFor="vehicleId" className="sr-only">Véhicule</label><Select id="vehicleId" name="vehicleId" defaultValue={vehicleId} className="max-w-xs">{h.vehicles.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</Select><Button type="submit" variant="secondary">Afficher</Button></form>
      )}
      {drift && <Notice tone="warn" title="Dérive de consommation">Le dernier intervalle mesuré ({formatConsumption(last!.consumptionL100)}) dépasse de plus de 15 % votre moyenne ({formatConsumption(s.averageL100)}). Vérifiez pression des pneus, charge, conditions de conduite ou une saisie.</Notice>}

      <div className="grid gap-4 sm:grid-cols-3">
        <Card><Stat label="Consommation moyenne" value={s.averageL100 ? formatConsumption(s.averageL100) : "—"} hint={`${measured.length} intervalle(s) mesuré(s), pondérée par la distance`} /></Card>
        <Card><Stat label="Économie calculée" value={s.hasReference ? formatSignedMoney(s.measuredGainTotal) : "—"} tone={s.measuredGainTotal.lt(0) ? "loss" : "gain"} hint={s.incompleteComparisons ? `${s.incompleteComparisons} comparaison(s) incomplète(s) exclue(s)` : "Comparaisons complètes"} /></Card>
        <Card><Stat label="Conversion" value={s.amortization ? (s.amortization.currentlyAmortized ? "Amortie" : formatMoney(s.amortization.remainingToAmortize)) : "—"} hint={s.amortization ? (s.amortization.currentlyAmortized ? `Gain net ${formatSignedMoney(s.amortization.netAfterConversion)}` : "Reste à amortir") : "Aucune conversion déclarée"} /></Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Dépenses par mois (date d'achat)">
          <BarChart label="Dépenses mensuelles" data={months.map((m) => ({ x: m.month, y: m.spend.toNumber() }))} format={(n) => formatMoney(n)} />
        </Card>
        <Card title="Économie mesurée par mois">
          <BarChart signed label="Économie mensuelle" data={months.map((m) => ({ x: m.month, y: m.measuredGain?.toNumber() ?? null }))} format={(n) => formatSignedMoney(n)} />
        </Card>
        <Card title="Consommation par intervalle" className="lg:col-span-2">
          <LineChart label="Consommation par intervalle mesuré" data={measured.map((i) => ({ x: formatDate(i.closedAt), y: i.consumptionL100!.toNumber() }))} format={(n) => formatConsumption(n)} />
        </Card>
      </div>

      <Card title="Tableau mensuel">
        <Table
          caption="Les mesures sont attribuées au mois de fermeture de l'intervalle ; les dépenses au mois d'achat."
          head={["Mois", "Dépenses", "Volume", "Distance mesurée", "Consommation", "Économie", "Incomplètes"]}
          rows={months.map((m) => [m.month, formatMoney(m.spend), formatLiters(m.liters), formatKm(m.measuredDistanceKm), m.consumptionL100 ? formatConsumption(m.consumptionL100) : "—", m.measuredGain ? formatSignedMoney(m.measuredGain) : "—", String(m.incompleteComparisons)])}
        />
      </Card>

      <Card title="Intervalles plein à plein">
        {s.intervals.length ? (
          <Table
            head={["Fermé le", "Distance", "Volume", "Coût", "L/100", "€/100 km", "Statut"]}
            rows={s.intervals.slice().reverse().map((i) => [
              formatDate(i.closedAt),
              formatKm(i.distanceKm),
              formatLiters(i.volumeL),
              formatMoney(i.cost),
              i.consumptionL100 ? formatConsumption(i.consumptionL100) : "—",
              i.costPer100 ? formatMoney(i.costPer100) : "—",
              <span key="s"><Badge tone={STATUS[i.status][1]}>{STATUS[i.status][0]}</Badge>{i.issues.length > 0 && <span className="block text-xs text-muted">{i.issues.map((x) => ISSUE_MESSAGES[x]).join(" ")}</span>}</span>,
            ])}
          />
        ) : (
          <p className="text-sm text-muted">{s.headline}</p>
        )}
      </Card>
    </div>
  );
}
