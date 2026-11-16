import Link from "next/link";
import { inArray } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { requireOrgPage } from "@/server/org-page";
import { listFillups } from "@/server/services/fillups";
import { listVehicles } from "@/server/services/vehicles";
import { D, sum } from "@/lib/decimal";
import { formatDateTime, formatLiters, formatMoney } from "@/lib/format";
import { Badge, Button, Card, EmptyState, ErrorFromQuery, Input, OkFromQuery, Select } from "@/components/ui";
import { decideFillupAction, markReimbursedAction } from "@/app/actions/fillups";

const STATUS: Record<string, string> = { submitted: "Soumis", to_complete: "À compléter", validated: "Validé", rejected: "Rejeté" };

export default async function Validations({ params, searchParams }: { params: Promise<{ orgId: string }>; searchParams: Promise<{ statut?: string; ok?: string; erreur?: string }> }) {
  const { orgId } = await params;
  const q = await searchParams;
  const { ctx } = await requireOrgPage(orgId);
  const db = getDb();
  const statut = q.statut && STATUS[q.statut] ? q.statut : "submitted";
  const { rows } = await listFillups(db, ctx, { organizationId: orgId, approvalStatus: statut, limit: 100 });
  const vehicles = await listVehicles(db, ctx, { organizationId: orgId, includeArchived: true });
  const drivers = rows.length ? await db.select({ id: schema.users.id, email: schema.users.email, name: schema.users.displayName }).from(schema.users).where(inArray(schema.users.id, rows.map((r) => r.driverUserId ?? r.createdBy))) : [];
  const back = `/entreprise/${orgId}/validations?statut=${statut}`;
  return (
    <div className="space-y-4">
      <OkFromQuery ok={q.ok} />
      <ErrorFromQuery error={q.erreur} />
      <form className="flex gap-2"><label htmlFor="statut" className="sr-only">Statut</label><Select id="statut" name="statut" defaultValue={statut} className="max-w-xs">{Object.entries(STATUS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select><Button type="submit" variant="secondary">Filtrer</Button></form>
      {rows.length === 0 ? <EmptyState title="Rien à traiter">Aucun plein « {STATUS[statut]} ».</EmptyState> : (
        <ul className="space-y-3">
          {rows.map((f) => {
            const d = drivers.find((x) => x.id === (f.driverUserId ?? f.createdBy));
            return (
              <li key={f.id}>
                <Card>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <Link href={`/pleins/${f.id}`} className="font-semibold underline">{formatDateTime(f.occurredAt)} · {vehicles.find((v) => v.id === f.vehicleId)?.name}</Link>
                    <span className="num text-lg font-bold">{formatMoney(f.totalPaid)}</span>
                  </div>
                  <p className="text-sm text-muted">{d?.name ?? d?.email ?? "Conducteur"} · {formatLiters(sum(f.lines.map((l) => D(l.liters))))} · {f.usage}{f.category ? ` · ${f.category}` : ""}</p>
                  <p className="mt-1 flex flex-wrap gap-1">{f.receiptAttachmentId ? <Badge tone="gain">Justificatif joint</Badge> : <Badge tone="warn">Justificatif manquant</Badge>}{f.approvalReason && <Badge tone="warn">Motif : {f.approvalReason}</Badge>}{f.reimbursedAt && <Badge tone="gain">Remboursé</Badge>}</p>
                  {(statut === "submitted" || statut === "to_complete") && (
                    <form action={decideFillupAction} className="mt-2 flex flex-wrap items-end gap-2">
                      <input type="hidden" name="fillupId" value={f.id} /><input type="hidden" name="back" value={back} />
                      <label className="sr-only" htmlFor={`r-${f.id}`}>Motif</label>
                      <Input id={`r-${f.id}`} name="reason" placeholder="Motif (rejet ou complément)" className="max-w-xs" />
                      <Button name="decision" value="validated">Valider</Button>
                      <Button name="decision" value="to_complete" variant="secondary">À compléter</Button>
                      <Button name="decision" value="rejected" variant="danger">Rejeter</Button>
                    </form>
                  )}
                  {statut === "validated" && !f.reimbursedAt && (
                    <form action={markReimbursedAction} className="mt-2"><input type="hidden" name="fillupId" value={f.id} /><input type="hidden" name="back" value={back} /><Button type="submit" variant="secondary">Marquer remboursé</Button></form>
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
