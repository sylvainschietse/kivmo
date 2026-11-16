import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { requireSession } from "@/server/session";
import { listPartners, myQuoteRequests, QUOTE_STATUS_LABELS, MAX_QUOTE_RECIPIENTS } from "@/server/services/partners";
import { listVehicles } from "@/server/services/vehicles";
import { formatDateTime } from "@/lib/format";
import { Badge, Button, Card, EmptyState, ErrorFromQuery, Field, Input, Notice, OkFromQuery, PageHeader, Select, Textarea } from "@/components/ui";
import { draftQuoteAction, sendQuoteAction, withdrawConsentAction } from "@/app/actions/partners";

export const metadata = { title: "Partenaires" };

export default async function Partenaires({ searchParams }: { searchParams: Promise<{ service?: string; zone?: string; demande?: string; pros?: string; ok?: string; erreur?: string }> }) {
  const q = await searchParams;
  const { ctx, user } = await requireSession();
  const db = getDb();
  const partners = await listPartners(db, { includeDemo: ctx.isDemo, service: q.service || null, zone: q.zone || null });
  const mine = await myQuoteRequests(db, ctx);
  const vehicles = await listVehicles(db, ctx);
  const draft = q.demande ? mine.find((m) => m.request.id === q.demande && !m.request.sentAt) : null;
  const chosen = draft && q.pros ? (await Promise.all(q.pros.split(",").slice(0, MAX_QUOTE_RECIPIENTS).map(async (id) => (/^[0-9a-f-]{36}$/.test(id) ? (await db.select().from(schema.partners).where(eq(schema.partners.id, id)))[0] : undefined)))).filter(Boolean) : [];

  return (
    <div className="space-y-4">
      <PageHeader title="Partenaires" subtitle="Professionnels vérifiés (conversion E85, entretien). Aucune donnée n'est partagée sans votre accord nominatif." />
      <OkFromQuery ok={q.ok} />
      <ErrorFromQuery error={q.erreur} />

      {draft && (
        <Card title="Confirmer l'envoi">
          <p className="text-sm">Besoin : <strong>{draft.request.need}</strong> · zone {draft.request.zone}{draft.request.vehicleSummary ? ` · ${draft.request.vehicleSummary}` : ""}</p>
          <p className="mt-1 text-sm">Seront transmis : ce besoin, la zone, le résumé du véhicule et votre contact ({draft.request.contactChannel === "email" ? "e-mail" : "téléphone"} : {draft.request.contactValue}). Jamais vos comptes, trajets ou pleins.</p>
          <form action={sendQuoteAction} className="mt-3 space-y-2">
            <input type="hidden" name="requestId" value={draft.request.id} />
            <input type="hidden" name="pros" value={chosen.map((p) => p!.id).join(",")} />
            {chosen.map((p) => (
              <label key={p!.id} className="flex items-start gap-2 text-sm"><input type="checkbox" name="consent" value={p!.id} className="mt-0.5 h-5 w-5" /> J&apos;accepte que <strong>{p!.name}</strong> reçoive ces informations pour me recontacter.</label>
            ))}
            <Button type="submit">Envoyer la demande</Button>
          </form>
        </Card>
      )}

      <Card title="Annuaire">
        <form className="mb-3 flex flex-wrap items-end gap-2">
          <Field label="Service" htmlFor="service"><Select id="service" name="service" defaultValue={q.service ?? ""}><option value="">Tous</option><option value="conversion_e85">Conversion E85</option><option value="entretien">Entretien</option><option value="pneus">Pneus</option><option value="controle_technique">Contrôle technique</option></Select></Field>
          <Field label="Code postal / département" htmlFor="zone"><Input id="zone" name="zone" defaultValue={q.zone} inputMode="numeric" /></Field>
          <Button type="submit" variant="secondary">Filtrer</Button>
        </form>
        {partners.length === 0 ? (
          <EmptyState title="Aucun professionnel vérifié">L&apos;annuaire se remplit au fil des inscriptions vérifiées par KIVMO.</EmptyState>
        ) : (
          <form action={draftQuoteAction} className="space-y-3">
            <ul className="grid gap-2 sm:grid-cols-2">
              {partners.map((p) => (
                <li key={p.id}>
                  <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-line p-3">
                    <input type="checkbox" name="partnerId" value={p.id} className="mt-1 h-5 w-5" />
                    <span>
                      <strong>{p.name}</strong> {p.isDemo && <Badge tone="lime">Démo</Badge>} <Badge tone="gain">Vérifié</Badge>
                      <span className="block text-sm text-muted">{p.city} · {p.services.join(", ")} · zones {p.zones.join(", ")}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted">Choisissez au maximum {MAX_QUOTE_RECIPIENTS} professionnels.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Véhicule" htmlFor="vehicleId"><Select id="vehicleId" name="vehicleId"><option value="">Non précisé</option>{vehicles.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</Select></Field>
              <Field label="Zone (code postal)" htmlFor="zone-r"><Input id="zone-r" name="zone" required inputMode="numeric" /></Field>
              <div className="sm:col-span-2"><Field label="Votre besoin" htmlFor="need"><Textarea id="need" name="need" required maxLength={1000} placeholder="Devis pour un boîtier E85 homologué…" /></Field></div>
              <Field label="Être contacté par" htmlFor="contactChannel"><Select id="contactChannel" name="contactChannel"><option value="email">E-mail</option><option value="telephone">Téléphone</option></Select></Field>
              <Field label="Coordonnée" htmlFor="contactValue"><Input id="contactValue" name="contactValue" required defaultValue={ctx.isDemo ? "" : user.email} /></Field>
            </div>
            <Button type="submit">Préparer la demande</Button>
          </form>
        )}
      </Card>

      <Card title="Mes demandes">
        {mine.filter((m) => m.request.sentAt).length === 0 ? <p className="text-sm text-muted">Aucune demande envoyée.</p> : (
          <ul className="space-y-3">
            {mine.filter((m) => m.request.sentAt).map(({ request: r, recipients }) => (
              <li key={r.id} className="rounded-xl border border-line p-3 text-sm">
                <p><strong>{r.need}</strong> · envoyée le {formatDateTime(r.sentAt!)}</p>
                <ul className="mt-1 space-y-1">
                  {recipients.map(({ r: rec, p }) => (
                    <li key={rec.id} className="flex flex-wrap items-center gap-2">
                      {p.name} <Badge tone="info">{QUOTE_STATUS_LABELS[rec.status] ?? rec.status}</Badge>
                      {rec.status !== "clos" && <form action={withdrawConsentAction}><input type="hidden" name="recipientId" value={rec.id} /><button className="tap text-sm font-semibold text-loss underline">Retirer mon consentement</button></form>}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Notice tone="info">Un professionnel listé ici a été vérifié par KIVMO ; cela ne garantit ni le prix ni la conformité d&apos;une installation. Demandez toujours un devis écrit.</Notice>
    </div>
  );
}
