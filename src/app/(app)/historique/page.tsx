import Link from "next/link";
import { getDb } from "@/db/client";
import { requireSession } from "@/server/session";
import { listFillups } from "@/server/services/fillups";
import { listVehicles } from "@/server/services/vehicles";
import { D, sum } from "@/lib/decimal";
import { formatDateTime, formatKm, formatLiters, formatMoney } from "@/lib/format";
import { FUEL_LABELS, FUELS, type FuelCode } from "@/domain/types";
import { Badge, Button, Card, EmptyState, Field, Input, LinkButton, PageHeader, Select } from "@/components/ui";

export const metadata = { title: "Historique" };

type Q = { vehicleId?: string; from?: string; to?: string; fuel?: string; usage?: string; q?: string; page?: string };

export default async function Historique({ searchParams }: { searchParams: Promise<Q> }) {
  const q = await searchParams;
  const { ctx } = await requireSession();
  const db = getDb();
  const vehicles = await listVehicles(db, ctx, { includeArchived: true });
  const own = vehicles.filter((v) => !v.organizationId);
  const page = Math.max(1, Number(q.page ?? 1) || 1);
  const filters = {
    vehicleId: q.vehicleId || undefined,
    from: q.from ? new Date(q.from) : undefined,
    to: q.to ? new Date(q.to + "T23:59:59Z") : undefined,
    fuel: (FUELS as readonly string[]).includes(q.fuel ?? "") ? (q.fuel as FuelCode) : undefined,
    usage: ["personnel", "professionnel", "mixte"].includes(q.usage ?? "") ? (q.usage as "personnel") : undefined,
    q: q.q || undefined,
  };
  const { rows, total } = await listFillups(db, ctx, { ...filters, limit: 25, offset: (page - 1) * 25 });
  const exportQs = new URLSearchParams(Object.entries({ vehicleId: q.vehicleId, from: q.from, to: q.to, fuel: filters.fuel, usage: filters.usage }).filter(([, v]) => v) as [string, string][]);
  const qsPage = (p: number) => `/historique?${new URLSearchParams({ ...(q as Record<string, string>), page: String(p) })}`;

  return (
    <div className="space-y-4">
      <PageHeader title="Historique" subtitle={`${total} plein(s)`} action={<LinkButton href="/pleins/nouveau" variant="lime">Ajouter un plein</LinkButton>} />
      <Card>
        <form className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6" role="search">
          <Field label="Véhicule" htmlFor="vehicleId"><Select id="vehicleId" name="vehicleId" defaultValue={q.vehicleId ?? ""}><option value="">Tous</option>{own.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</Select></Field>
          <Field label="Du" htmlFor="from"><Input id="from" name="from" type="date" defaultValue={q.from} /></Field>
          <Field label="Au" htmlFor="to"><Input id="to" name="to" type="date" defaultValue={q.to} /></Field>
          <Field label="Carburant" htmlFor="fuel"><Select id="fuel" name="fuel" defaultValue={q.fuel ?? ""}><option value="">Tous</option>{FUELS.map((f) => <option key={f} value={f}>{FUEL_LABELS[f]}</option>)}</Select></Field>
          <Field label="Usage" htmlFor="usage"><Select id="usage" name="usage" defaultValue={q.usage ?? ""}><option value="">Tous</option><option value="personnel">Personnel</option><option value="professionnel">Professionnel</option><option value="mixte">Mixte</option></Select></Field>
          <Field label="Recherche" htmlFor="q"><Input id="q" name="q" type="search" placeholder="Station, catégorie" defaultValue={q.q} /></Field>
          <div className="flex flex-wrap gap-2 sm:col-span-3 lg:col-span-6">
            <Button type="submit">Filtrer</Button>
            <a className="tap inline-flex items-center rounded-xl bg-surface-2 px-4 text-sm font-semibold" href={`/api/exports?${exportQs}`}>Exporter CSV</a>
            <a className="tap inline-flex items-center rounded-xl bg-surface-2 px-4 text-sm font-semibold" href={`/api/exports?${exportQs}&format=pdf`}>Exporter PDF</a>
          </div>
        </form>
      </Card>
      {rows.length === 0 ? (
        <EmptyState title="Aucun plein" action={<LinkButton href="/pleins/nouveau">Ajouter un plein</LinkButton>}>Aucun plein ne correspond à ces filtres.</EmptyState>
      ) : (
        <ul className="space-y-2">
          {rows.map((f) => {
            const liters = sum(f.lines.map((l) => D(l.liters)));
            const v = vehicles.find((x) => x.id === f.vehicleId);
            return (
              <li key={f.id}>
                <Link href={`/pleins/${f.id}`} className="block rounded-2xl border border-line bg-surface p-3 hover:border-green">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-semibold">{formatDateTime(f.occurredAt)} · {v?.name}</span>
                    <span className="num text-lg font-bold">{formatMoney(f.totalPaid, f.currency)}</span>
                  </div>
                  <p className="num text-sm text-muted">
                    {f.lines.map((l) => FUEL_LABELS[l.fuel as FuelCode]).join(" + ")} · {formatLiters(liters)} · {formatKm(f.odometerKm)}{f.stationLabel ? ` · ${f.stationLabel}` : ""}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    <Badge tone={f.isFull ? "info" : "neutral"}>{f.isFull ? "Complet" : "Partiel"}</Badge>
                    {f.missedBefore && <Badge tone="warn">Achat oublié avant</Badge>}
                    {f.receiptAttachmentId && <Badge tone="neutral">Ticket</Badge>}
                    {f.approvalStatus !== "not_required" && <Badge tone={f.approvalStatus === "validated" ? "gain" : f.approvalStatus === "rejected" ? "loss" : "info"}>{f.approvalStatus === "validated" ? "Validé" : f.approvalStatus === "rejected" ? "Rejeté" : f.approvalStatus === "to_complete" ? "À compléter" : "Soumis"}</Badge>}
                    {f.source === "demo" && <Badge tone="lime">Démo</Badge>}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {total > 25 && (
        <nav aria-label="Pagination" className="flex justify-between">
          {page > 1 ? <Link className="tap inline-flex items-center font-semibold text-green" href={qsPage(page - 1)}>← Précédents</Link> : <span />}
          {page * 25 < total && <Link className="tap inline-flex items-center font-semibold text-green" href={qsPage(page + 1)}>Suivants →</Link>}
        </nav>
      )}
    </div>
  );
}
