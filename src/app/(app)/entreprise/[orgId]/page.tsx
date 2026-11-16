import { getDb } from "@/db/client";
import { requireOrgPage } from "@/server/org-page";
import { fleetDashboard, orgRole } from "@/server/services/organizations";
import { listVehicles } from "@/server/services/vehicles";
import { formatConsumption, formatKm, formatLiters, formatMoney } from "@/lib/format";
import { Badge, Button, Card, ErrorFromQuery, Field, Input, Notice, OkFromQuery, Select, Stat, Table } from "@/components/ui";
import { upsertBudgetAction } from "@/app/actions/organizations";

export default async function OrgDashboard({ params, searchParams }: { params: Promise<{ orgId: string }>; searchParams: Promise<{ from?: string; to?: string; ok?: string; erreur?: string }> }) {
  const { orgId } = await params;
  const q = await searchParams;
  const { ctx } = await requireOrgPage(orgId);
  const db = getDb();
  const now = new Date();
  const from = q.from ? new Date(q.from) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const to = q.to ? new Date(q.to + "T23:59:59Z") : now;
  const d = await fleetDashboard(db, ctx, orgId, from, to);
  const role = await orgRole(db, ctx, orgId);
  const admin = role === "owner" || role === "fleet_admin";
  const vehicles = admin ? await listVehicles(db, ctx, { organizationId: orgId }) : [];
  const fromS = from.toISOString().slice(0, 10), toS = to.toISOString().slice(0, 10);
  const exportQs = `organizationId=${orgId}&from=${fromS}&to=${toS}`;

  return (
    <div className="space-y-4">
      <OkFromQuery ok={q.ok} />
      <ErrorFromQuery error={q.erreur} />
      <form className="flex flex-wrap items-end gap-2">
        <Field label="Du" htmlFor="from"><Input id="from" name="from" type="date" defaultValue={fromS} /></Field>
        <Field label="Au" htmlFor="to"><Input id="to" name="to" type="date" defaultValue={toS} /></Field>
        <Button type="submit" variant="secondary">Afficher</Button>
        <a className="tap inline-flex items-center rounded-xl bg-surface-2 px-4 text-sm font-semibold" href={`/api/exports?${exportQs}`}>Export CSV comptable</a>
        <a className="tap inline-flex items-center rounded-xl bg-surface-2 px-4 text-sm font-semibold" href={`/api/exports?${exportQs}&format=pdf`}>Export PDF</a>
      </form>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card><Stat label="Dépenses" value={formatMoney(d.totalSpend)} hint={formatLiters(d.totalLiters)} /></Card>
        <Card><Stat label="Coût au km" value={d.costPerKm ? formatMoney(d.costPerKm) : "—"} hint={`${formatKm(d.documentedKm)} documentés (plein à plein)`} /></Card>
        <Card><Stat label="Consommation flotte" value={d.consumptionL100 ? formatConsumption(d.consumptionL100) : "—"} hint="Intervalles mesurés seulement" /></Card>
        <Card><Stat label="À traiter" value={`${d.pendingApprovals} validation(s)`} hint={`${d.missingReceipts} justificatif(s) manquant(s)`} /></Card>
      </div>
      {d.anomalies.length > 0 && <Notice tone="warn" title="Anomalies">{d.anomalies.slice(0, 8).map((a, i) => <span key={i} className="block">{a.message}</span>)}</Notice>}
      <Card title="Par véhicule">
        <Table head={["Véhicule", "Dépenses", "Volume", "Km documentés", "L/100"]} rows={d.byVehicle.map((v) => [v.name, formatMoney(v.spend), formatLiters(v.liters), formatKm(v.documentedKm), v.consumptionL100 ? formatConsumption(v.consumptionL100) : "—"])} />
      </Card>
      <Card title="Par conducteur">
        <Table head={["Conducteur", "Dépenses", "Volume", "L/100", "Méthode"]} rows={d.byDriver.map((r) => [r.label, formatMoney(r.spend), formatLiters(r.liters), r.consumptionL100 ? formatConsumption(r.consumptionL100) : "—", <span key="n" className="text-xs text-muted">{r.note}</span>])} />
      </Card>
      <Card title="Budgets">
        {d.budgets.length ? (
          <ul className="space-y-2">
            {d.budgets.map((b) => (
              <li key={b.id} className="text-sm">
                <div className="flex justify-between"><span>{b.label}</span><span className="num">{formatMoney(b.consumed)} / {formatMoney(b.amount)} {b.alert && <Badge tone="loss">Seuil d&apos;alerte atteint</Badge>}</span></div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-label={b.label} aria-valuenow={Math.round(b.ratio.toNumber() * 100)} aria-valuemin={0} aria-valuemax={100}><div className={`h-full ${b.alert ? "bg-loss" : "bg-green"}`} style={{ width: `${Math.min(100, b.ratio.toNumber() * 100)}%` }} /></div>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-muted">Aucun budget.</p>}
        {admin && (
          <form action={upsertBudgetAction} className="mt-3 grid gap-3 sm:grid-cols-5">
            <input type="hidden" name="organizationId" value={orgId} />
            <Field label="Portée" htmlFor="scope"><Select id="scope" name="scope"><option value="flotte">Flotte</option><option value="vehicule">Véhicule</option></Select></Field>
            <Field label="Véhicule (si portée véhicule)" htmlFor="scopeId"><Select id="scopeId" name="scopeId"><option value="">—</option>{vehicles.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</Select></Field>
            <Field label="Période" htmlFor="period"><Select id="period" name="period"><option value="mensuel">Mensuel</option><option value="annuel">Annuel</option></Select></Field>
            <Field label="Montant (€)" htmlFor="amount"><Input id="amount" name="amount" inputMode="decimal" required /></Field>
            <Field label="Alerte à (%)" htmlFor="alert"><Input id="alert" name="alert" type="number" min={1} max={200} defaultValue={80} /></Field>
            <div><Button type="submit">Ajouter le budget</Button></div>
          </form>
        )}
      </Card>
    </div>
  );
}
