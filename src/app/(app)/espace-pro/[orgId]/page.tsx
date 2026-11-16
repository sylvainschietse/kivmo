import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { requireSession } from "@/server/session";
import { incomingRequests, QUOTE_STATUS_LABELS } from "@/server/services/partners";
import { AppError } from "@/server/errors";
import { integrations } from "@/integrations/registry";
import { formatDateTime } from "@/lib/format";
import { Badge, Button, Card, EmptyState, ErrorFromQuery, IntegrationPill, Notice, OkFromQuery, PageHeader, Select } from "@/components/ui";
import { updateRequestStatusAction } from "@/app/actions/organizations";

export const metadata = { title: "Espace professionnel" };

export default async function EspacePro({ params, searchParams }: { params: Promise<{ orgId: string }>; searchParams: Promise<{ ok?: string; erreur?: string }> }) {
  const { orgId } = await params;
  const q = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(orgId)) notFound();
  const { ctx } = await requireSession();
  const db = getDb();
  let data;
  try {
    data = await incomingRequests(db, ctx, orgId);
  } catch (e) {
    if (e instanceof AppError) return <EmptyState title="Espace professionnel indisponible">{e.message} La fiche est créée lors de la vérification par KIVMO.</EmptyState>;
    throw e;
  }
  const [sub] = await db.select().from(schema.subscriptions).where(eq(schema.subscriptions.organizationId, orgId));
  const billing = integrations().find((i) => i.key === "billing");
  return (
    <div className="space-y-4">
      <PageHeader title={data.partner.name} subtitle="Demandes reçues avec le consentement du client. Aucun accès aux comptes, trajets ou pleins." />
      <OkFromQuery ok={q.ok} />
      <ErrorFromQuery error={q.erreur} />
      {data.requests.length === 0 ? <EmptyState title="Aucune demande">Les demandes de devis apparaîtront ici.</EmptyState> : (
        <ul className="space-y-3">
          {data.requests.map((r) => (
            <li key={r.recipientId}>
              <Card>
                <div className="flex flex-wrap items-center justify-between gap-2"><strong>{r.need}</strong><Badge tone="info">{QUOTE_STATUS_LABELS[r.status] ?? r.status}</Badge></div>
                <p className="text-sm text-muted">Zone {r.zone}{r.vehicleSummary ? ` · ${r.vehicleSummary}` : ""}{r.sentAt ? ` · reçue le ${formatDateTime(r.sentAt)}` : ""}</p>
                {r.contact ? <p className="mt-1 text-sm">Contact ({r.contact.channel === "email" ? "e-mail" : "téléphone"}) : <strong>{r.contact.value}</strong></p> : <Notice tone="warn">Le client a retiré son consentement : coordonnées masquées.</Notice>}
                {!r.consentRevoked && r.status !== "clos" && (
                  <form action={updateRequestStatusAction} className="mt-2 flex flex-wrap items-end gap-2">
                    <input type="hidden" name="organizationId" value={orgId} /><input type="hidden" name="recipientId" value={r.recipientId} />
                    <label className="sr-only" htmlFor={`st-${r.recipientId}`}>Statut</label>
                    <Select id={`st-${r.recipientId}`} name="status" defaultValue={r.status} className="max-w-xs">{["recu", "contacte", "devis", "installation", "clos"].map((s) => <option key={s} value={s}>{QUOTE_STATUS_LABELS[s]}</option>)}</Select>
                    <Button type="submit" variant="secondary">Mettre à jour</Button>
                  </form>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
      <Card title="Abonnement professionnel" action={billing ? <IntegrationPill status={billing.status} /> : null}>
        <p className="text-sm">{sub ? `Formule ${sub.plan} · ${sub.status}` : "Aucun abonnement."} La facturation en ligne n&apos;est pas connectée : aucun paiement n&apos;est demandé dans l&apos;application.</p>
      </Card>
    </div>
  );
}
