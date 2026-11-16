import { getDb } from "@/db/client";
import { requireOrgPage } from "@/server/org-page";
import { listPeriods } from "@/server/services/periods";
import { orgRole } from "@/server/services/organizations";
import { formatDate, formatDateTime } from "@/lib/format";
import { Badge, Button, Card, ErrorFromQuery, Field, Input, OkFromQuery, Table } from "@/components/ui";
import { closePeriodAction, reopenPeriodAction } from "@/app/actions/organizations";

export default async function Periods({ params, searchParams }: { params: Promise<{ orgId: string }>; searchParams: Promise<{ ok?: string; erreur?: string }> }) {
  const { orgId } = await params;
  const q = await searchParams;
  const { ctx } = await requireOrgPage(orgId);
  const db = getDb();
  const role = await orgRole(db, ctx, orgId);
  const admin = role === "owner" || role === "fleet_admin";
  const periods = await listPeriods(db, ctx, orgId);
  const prev = new Date();
  prev.setUTCMonth(prev.getUTCMonth() - 1);
  return (
    <div className="space-y-4">
      <OkFromQuery ok={q.ok} />
      <ErrorFromQuery error={q.erreur} />
      <Card title="Périodes comptables">
        {periods.length ? (
          <Table
            head={["Période", "État", "Clôturée le", ""]}
            rows={periods.map((p) => [
              `${formatDate(p.startsOn)} → ${formatDate(p.endsOn)}`,
              p.closedAt && !p.reopenedAt ? <Badge key="s" tone="warn">Clôturée</Badge> : <Badge key="s" tone="gain">{p.reopenedAt ? `Rouverte : ${p.reopenReason}` : "Ouverte"}</Badge>,
              p.closedAt ? formatDateTime(p.closedAt) : "—",
              admin && p.closedAt && !p.reopenedAt ? (
                <form key="f" action={reopenPeriodAction} className="flex gap-2"><input type="hidden" name="organizationId" value={orgId} /><input type="hidden" name="month" value={String(p.startsOn).slice(0, 7)} /><label className="sr-only" htmlFor={`rr-${p.id}`}>Motif</label><Input id={`rr-${p.id}`} name="reason" required placeholder="Motif obligatoire" /><Button type="submit" variant="secondary">Rouvrir</Button></form>
              ) : "",
            ])}
          />
        ) : <p className="text-sm text-muted">Aucune période clôturée.</p>}
        {admin && (
          <form action={closePeriodAction} className="mt-3 flex flex-wrap items-end gap-2">
            <input type="hidden" name="organizationId" value={orgId} />
            <Field label="Mois à clôturer" htmlFor="month"><Input id="month" name="month" type="month" defaultValue={prev.toISOString().slice(0, 7)} required /></Field>
            <Button type="submit">Clôturer</Button>
          </form>
        )}
        <p className="mt-2 text-xs text-muted">Après clôture, un plein de la période ne peut être corrigé que par un administrateur, avec un motif journalisé.</p>
      </Card>
    </div>
  );
}
