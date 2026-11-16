import { desc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { getDb, schema } from "@/db/client";
import { requireSession } from "@/server/session";
import { integrations, STATUS_LABELS } from "@/integrations/registry";
import { formatDateTime, formatUnitPrice } from "@/lib/format";
import { FUEL_LABELS, type FuelCode } from "@/domain/types";
import { Button, Card, ErrorFromQuery, Field, Input, IntegrationPill, OkFromQuery, PageHeader, Table } from "@/components/ui";
import { triggerImportAction, verifyPartnerAction } from "@/app/actions/admin";
import { moderateReportAction } from "@/app/actions/stations";

export const metadata = { title: "Administration" };

export default async function Admin({ searchParams }: { searchParams: Promise<{ ok?: string; erreur?: string }> }) {
  const q = await searchParams;
  const { ctx } = await requireSession();
  if (!ctx.isPlatformAdmin) notFound();
  const db = getDb();
  const health = await db.select().from(schema.integrationHealth);
  const jobs = await db.select().from(schema.importJobs).orderBy(desc(schema.importJobs.startedAt)).limit(10);
  const reports = await db.select({ r: schema.availabilityReports, s: schema.stations }).from(schema.availabilityReports).innerJoin(schema.stations, eq(schema.stations.id, schema.availabilityReports.stationId)).where(eq(schema.availabilityReports.status, "en_attente")).orderBy(desc(schema.availabilityReports.createdAt)).limit(30);
  const partnerOrgs = await db.select({ o: schema.organizations, p: schema.partners }).from(schema.organizations).leftJoin(schema.partners, eq(schema.partners.organizationId, schema.organizations.id)).where(eq(schema.organizations.kind, "partenaire"));
  const auditRows = await db.select().from(schema.auditEvents).orderBy(desc(schema.auditEvents.createdAt)).limit(30);
  return (
    <div className="space-y-4">
      <PageHeader title="Administration KIVMO" subtitle="Santé des intégrations, imports, modération et journal d'audit." />
      <OkFromQuery ok={q.ok} />
      <ErrorFromQuery error={q.erreur} />
      <Card title="Intégrations">
        <Table head={["Service", "État", "Dernier succès", "Dernière erreur"]} rows={integrations().map((i) => {
          const h = health.find((x) => x.key === i.key);
          return [i.label, <span key="s"><IntegrationPill status={i.status} /> <span className="sr-only">{STATUS_LABELS[i.status]}</span></span>, h?.lastSuccessAt ? formatDateTime(h.lastSuccessAt) : "—", h?.lastError ?? "—"];
        })} />
      </Card>
      <Card title="Import des prix officiels">
        <form action={triggerImportAction} className="flex flex-wrap items-end gap-2">
          <Field label="Département" htmlFor="department"><Input id="department" name="department" defaultValue="75" maxLength={3} /></Field>
          <Button type="submit">Lancer l&apos;import</Button>
        </form>
        {jobs.length > 0 && <Table head={["Début", "Fin", "État", "Détail"]} rows={jobs.map((j) => [formatDateTime(j.startedAt), j.finishedAt ? formatDateTime(j.finishedAt) : "—", j.status, <code key="d" className="text-xs">{(j.error ?? JSON.stringify(j.stats)).slice(0, 120)}</code>])} />}
      </Card>
      <Card title="Signalements à modérer">
        {reports.length === 0 ? <p className="text-sm text-muted">Rien à modérer.</p> : (
          <ul className="space-y-2 text-sm">
            {reports.map(({ r, s }) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-surface-2 p-2">
                <span>{s.name ?? s.city} · {r.kind}{r.fuel ? ` ${FUEL_LABELS[r.fuel as FuelCode]}` : ""}{r.reportedPrice ? ` · ${formatUnitPrice(r.reportedPrice)}` : ""} · {formatDateTime(r.createdAt)}</span>
                <span className="flex gap-2">
                  {(["accepte", "rejete"] as const).map((d) => <form key={d} action={moderateReportAction}><input type="hidden" name="reportId" value={r.id} /><input type="hidden" name="decision" value={d} /><Button type="submit" variant={d === "rejete" ? "danger" : "secondary"}>{d === "accepte" ? "Accepter" : "Rejeter"}</Button></form>)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="Professionnels">
        {partnerOrgs.length === 0 ? <p className="text-sm text-muted">Aucune organisation partenaire.</p> : (
          <ul className="space-y-2">
            {partnerOrgs.map(({ o, p }) => (
              <li key={o.id} className="rounded-xl border border-line p-2 text-sm">
                <strong>{o.name}</strong> {p?.verifiedAt ? `· vérifié le ${formatDateTime(p.verifiedAt)}` : "· non vérifié"}
                <form action={verifyPartnerAction} className="mt-2 grid gap-2 sm:grid-cols-4">
                  <input type="hidden" name="organizationId" value={o.id} />
                  <Field label="Services (virgules)" htmlFor={`sv-${o.id}`}><Input id={`sv-${o.id}`} name="services" defaultValue={p?.services.join(", ") ?? "conversion_e85"} /></Field>
                  <Field label="Zones (codes postaux)" htmlFor={`z-${o.id}`}><Input id={`z-${o.id}`} name="zones" defaultValue={p?.zones.join(", ") ?? ""} /></Field>
                  <Field label="Ville" htmlFor={`c-${o.id}`}><Input id={`c-${o.id}`} name="city" defaultValue={p?.city ?? ""} /></Field>
                  <div className="flex items-end"><Button type="submit" variant="secondary">{p?.verifiedAt ? "Mettre à jour" : "Vérifier"}</Button></div>
                </form>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="Journal d'audit (30 derniers)">
        <Table head={["Date", "Action", "Ressource", "Détails"]} rows={auditRows.map((a) => [formatDateTime(a.createdAt), a.action, `${a.resourceType}${a.resourceId ? ` ${a.resourceId.slice(0, 8)}` : ""}`, <code key="d" className="text-xs">{JSON.stringify(a.details ?? {}).slice(0, 100)}</code>])} />
      </Card>
    </div>
  );
}
