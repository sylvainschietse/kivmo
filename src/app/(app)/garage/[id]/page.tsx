import { desc, eq } from "drizzle-orm";
import { BackButton } from "@/components/back-button";
import { getDb, schema } from "@/db/client";
import { requireSession } from "@/server/session";
import { requireVehicle } from "@/server/authz";
import { listReferenceProfiles, getConversion } from "@/server/services/vehicles";
import { vehicleSummary } from "@/server/services/dashboard";
import { AppError } from "@/server/errors";
import { D } from "@/lib/decimal";
import { formatDate, formatKm, formatMoney, formatSignedMoney, formatUnitPrice, formatNumber } from "@/lib/format";
import { FUEL_LABELS, FUELS, type FuelCode } from "@/domain/types";
import { Badge, Button, Card, EmptyState, ErrorFromQuery, Field, Input, Notice, OkFromQuery, PageHeader, Select, Table, Textarea } from "@/components/ui";
import { VehicleFields } from "@/components/forms/vehicle-fields";
import { VehicleScan } from "@/components/forms/vehicle-scan";
import { MaintenanceScan } from "@/components/forms/maintenance-scan";
import { ocrAvailable } from "@/integrations/ocr";
import { signAttachmentUrl } from "@/server/auth";
import { addMaintenanceAction, addReferenceAction, archiveVehicleAction, completeReminderAction, odometerReplacementAction, setConversionAction, updateVehicleAction } from "@/app/actions/vehicles";

const KIND_LABELS: Record<string, string> = { ancien_vehicule: "Ancien véhicule", meme_vehicule_autre_carburant: "Même véhicule, autre carburant", scenario_libre: "Scénario libre" };
const MAINT: Record<string, string> = { entretien: "Entretien", controle_technique: "Contrôle technique", pneus: "Pneus", reparation: "Réparation", immobilisation: "Immobilisation" };

export default async function VehiculeDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; erreur?: string }> }) {
  const { id } = await params;
  const q = await searchParams;
  const { ctx } = await requireSession();
  const db = getDb();
  let vehicle;
  try {
    vehicle = (await requireVehicle(db, ctx, id, "read")).vehicle;
  } catch (e) {
    if (e instanceof AppError) return <EmptyState title="Véhicule introuvable">Ce véhicule n&apos;existe pas ou vous n&apos;y avez pas accès.</EmptyState>;
    throw e;
  }
  const refs = await listReferenceProfiles(db, ctx, id);
  const conv = await getConversion(db, id);
  const summary = await vehicleSummary(db, ctx, id);
  const events = await db.select().from(schema.odometerEvents).where(eq(schema.odometerEvents.vehicleId, id));
  const maint = await db.select().from(schema.maintenanceEvents).where(eq(schema.maintenanceEvents.vehicleId, id)).orderBy(desc(schema.maintenanceEvents.occurredOn));
  const reminders = await db.select().from(schema.reminders).where(eq(schema.reminders.vehicleId, id));
  const maintTotal = maint.reduce((a, m) => a.plus(m.cost ?? 0), D(0));
  const today = new Date().toISOString().slice(0, 10);
  const photoUrl = vehicle.photoAttachmentId ? signAttachmentUrl(vehicle.photoAttachmentId, 3600) : null;

  return (
    <div className="space-y-4">
      {photoUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photoUrl} alt={`Photo de ${vehicle.name}`} className="h-40 w-full rounded-2xl object-cover sm:h-56" />
      )}
      <BackButton fallback="/garage" />
      <PageHeader title={vehicle.name} subtitle={[vehicle.make, vehicle.model, vehicle.year, vehicle.engine].filter(Boolean).join(" · ") || "Véhicule"} />
      <OkFromQuery ok={q.ok} />
      <ErrorFromQuery error={q.erreur} />

      <Card title="Références de comparaison" action={<Badge tone="info">Versions historisées</Badge>}>
        {refs.length ? (
          <Table
            head={["Version", "Libellé", "Carburant", "Conso.", "Prix", "Effet", "Confiance"]}
            rows={refs.map((r) => [
              `v${r.profileVersion}`,
              <span key="l">{r.label}<span className="block text-xs text-muted">{KIND_LABELS[r.kind]}</span></span>,
              FUEL_LABELS[r.fuel as FuelCode],
              `${formatNumber(r.consumptionL100, 2)} L/100`,
              r.priceMode === "fixed" ? `Fixe ${formatUnitPrice(r.fixedPrice)}` : "Prix datés pondérés",
              formatDate(r.effectiveFrom),
              r.confidence,
            ])}
          />
        ) : (
          <p className="text-sm text-muted">Aucune référence : l&apos;économie ne peut pas être calculée.</p>
        )}
        <details className="mt-4">
          <summary className="tap cursor-pointer text-sm font-semibold text-green">Ajouter une nouvelle version</summary>
          <p className="mt-2 text-xs text-muted">Une nouvelle version s&apos;applique aux intervalles clos à partir de sa date d&apos;effet ; le passé n&apos;est pas réécrit. Nous ne prétendons pas connaître la consommation exacte qu&apos;aurait eue l&apos;ancien véhicule.</p>
          <form action={addReferenceAction} className="mt-3 grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="vehicleId" value={id} />
            <Field label="Type" htmlFor="kind"><Select id="kind" name="kind">{Object.entries(KIND_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
            <Field label="Libellé" htmlFor="label"><Input id="label" name="label" required /></Field>
            <Field label="Carburant" htmlFor="fuel"><Select id="fuel" name="fuel" defaultValue="GAZOLE">{FUELS.filter((f) => f !== "ELEC_KWH").map((f) => <option key={f} value={f}>{FUEL_LABELS[f]}</option>)}</Select></Field>
            <Field label="Consommation (L/100 km)" htmlFor="consumptionL100"><Input id="consumptionL100" name="consumptionL100" inputMode="decimal" required /></Field>
            <Field label="Méthode de prix" htmlFor="priceMode"><Select id="priceMode" name="priceMode"><option value="observed">Prix datés (moyenne pondérée par les litres)</option><option value="fixed">Prix fixe de scénario</option></Select></Field>
            <Field label="Prix fixe (€/L)" htmlFor="fixedPrice"><Input id="fixedPrice" name="fixedPrice" inputMode="decimal" /></Field>
            <Field label="Date d'effet" htmlFor="effectiveFrom"><Input id="effectiveFrom" name="effectiveFrom" type="date" defaultValue={today} /></Field>
            <Field label="Confiance" htmlFor="confidence"><Select id="confidence" name="confidence" defaultValue="moyenne"><option value="faible">Faible</option><option value="moyenne">Moyenne</option><option value="elevee">Élevée</option></Select></Field>
            <Field label="Méthode / source" htmlFor="method"><Input id="method" name="method" placeholder="ex. moyenne relevée sur 2 ans" /></Field>
            <div className="flex items-end"><Button type="submit">Enregistrer la version</Button></div>
          </form>
        </details>
      </Card>

      <Card title="Conversion" action={<span id="conversion" />}>
        {conv && summary.amortization ? (
          <div className="mb-3 grid gap-3 text-sm sm:grid-cols-4">
            <div><p className="text-muted">Coût</p><p className="num text-lg font-bold">{formatMoney(conv.cost)}</p></div>
            <div><p className="text-muted">Gains cumulés depuis</p><p className={`num text-lg font-bold ${summary.amortization.cumulativeGain.lt(0) ? "text-loss" : "text-green"}`}>{formatSignedMoney(summary.amortization.cumulativeGain)}</p></div>
            <div><p className="text-muted">Gain net actuel</p><p className={`num text-lg font-bold ${summary.amortization.netAfterConversion.lt(0) ? "text-loss" : "text-green"}`}>{formatSignedMoney(summary.amortization.netAfterConversion)}</p></div>
            <div><p className="text-muted">Reste à amortir</p><p className="num text-lg font-bold">{formatMoney(summary.amortization.remainingToAmortize)}</p></div>
            {summary.amortization.initialAmortizedAt && <p className="sm:col-span-4">Amortie une première fois le {formatDate(summary.amortization.initialAmortizedAt)}{summary.amortization.currentlyAmortized ? "." : ", mais des pertes ultérieures ont réduit le solde net."}</p>}
          </div>
        ) : null}
        <Notice tone="info" title="Saisie déclarative">Une conversion déclarée ne vaut pas validation réglementaire ou technique. Conservez les justificatifs du prestataire.</Notice>
        <form action={setConversionAction} className="mt-3 grid gap-3 sm:grid-cols-3">
          <input type="hidden" name="vehicleId" value={id} />
          <Field label="Type déclaré" htmlFor="declaredType"><Input id="declaredType" name="declaredType" defaultValue={conv?.declaredType ?? ""} required placeholder="Boîtier E85…" /></Field>
          <Field label="Date" htmlFor="date"><Input id="date" name="date" type="date" defaultValue={conv?.date ?? today} required /></Field>
          <Field label="Kilométrage" htmlFor="odometerKm"><Input id="odometerKm" name="odometerKm" inputMode="numeric" defaultValue={conv ? Number(conv.odometerKm).toFixed(0) : ""} required /></Field>
          <Field label="Coût (€)" htmlFor="cost"><Input id="cost" name="cost" inputMode="decimal" defaultValue={conv ? Number(conv.cost).toFixed(2) : ""} required /></Field>
          <Field label="Prestataire" htmlFor="provider"><Input id="provider" name="provider" defaultValue={conv?.provider ?? ""} /></Field>
          <Field label="Note" htmlFor="note"><Input id="note" name="note" defaultValue={conv?.note ?? ""} /></Field>
          <div><Button type="submit">{conv ? "Mettre à jour" : "Déclarer la conversion"}</Button></div>
        </form>
        <p className="mt-2 text-xs text-muted">Une conversion en milieu d&apos;intervalle exige un nouveau plein complet de repère : l&apos;intervalle à cheval n&apos;est pas compté.</p>
      </Card>

      <Card title="Entretien et échéances" action={<span id="entretien" />}>
        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <p className="mb-2 text-sm font-semibold">Échéances</p>
            {reminders.filter((r) => !r.doneAt).length ? (
              <ul className="space-y-2 text-sm">
                {reminders.filter((r) => !r.doneAt).map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-2 rounded-xl bg-surface-2 p-2">
                    <span>{MAINT[r.kind] ?? r.kind}{r.dueOn ? ` · le ${formatDate(r.dueOn)}` : ""}{r.dueOdometerKm ? ` · à ${formatKm(r.dueOdometerKm)}` : ""}{r.dueOn && r.dueOn < today ? <Badge tone="loss">En retard</Badge> : null}</span>
                    <form action={completeReminderAction}><input type="hidden" name="vehicleId" value={id} /><input type="hidden" name="reminderId" value={r.id} /><button className="tap text-sm font-semibold text-green underline">Fait</button></form>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-muted">Aucune échéance.</p>}
            <p className="mb-2 mt-4 text-sm font-semibold">Historique (coût total {formatMoney(maintTotal)})</p>
            {maint.length ? (
              <ul className="space-y-1 text-sm">
                {maint.map((m) => (
                  <li key={m.id}>
                    {formatDate(m.occurredOn)} · {MAINT[m.kind] ?? m.kind}{m.odometerKm ? ` · ${formatKm(m.odometerKm)}` : ""}{m.cost ? ` · ${formatMoney(m.cost)}` : ""}{m.downtimeDays ? ` · ${m.downtimeDays} j d'immobilisation` : ""}{m.note ? ` · ${m.note}` : ""}
                    {m.attachmentId && <> · <a href={signAttachmentUrl(m.attachmentId, 3600)} target="_blank" rel="noopener" className="font-semibold text-green underline">Voir la facture</a></>}
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-muted">Aucun entretien saisi.</p>}
          </div>
          <form action={addMaintenanceAction} className="grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="vehicleId" value={id} />
            <MaintenanceScan photoScan={ocrAvailable()} />
            <Field label="Enregistrer" htmlFor="mode"><Select id="mode" name="mode"><option value="evenement">Un entretien réalisé</option><option value="rappel">Une échéance à venir</option></Select></Field>
            <Field label="Nature" htmlFor="kind-m"><Select id="kind-m" name="kind">{Object.entries(MAINT).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
            <Field label="Date (réalisé)" htmlFor="occurredOn"><Input id="occurredOn" name="occurredOn" type="date" defaultValue={today} /></Field>
            <Field label="Coût (€)" htmlFor="cost-m"><Input id="cost-m" name="cost" inputMode="decimal" /></Field>
            <Field label="Kilométrage" htmlFor="odometerKm-m"><Input id="odometerKm-m" name="odometerKm" inputMode="numeric" /></Field>
            <Field label="Jours d'immobilisation" htmlFor="downtimeDays"><Input id="downtimeDays" name="downtimeDays" inputMode="numeric" /></Field>
            <Field label="Prochaine échéance : date" htmlFor="dueOn"><Input id="dueOn" name="dueOn" type="date" /></Field>
            <Field label="Prochaine échéance : kilométrage" htmlFor="dueOdometerKm"><Input id="dueOdometerKm" name="dueOdometerKm" inputMode="numeric" /></Field>
            <div className="sm:col-span-2"><Field label="Note" htmlFor="note-m"><Textarea id="note-m" name="note" /></Field></div>
            <div><Button type="submit">Ajouter</Button></div>
          </form>
        </div>
      </Card>

      <Card title="Compteur remplacé">
        {events.length > 0 && <ul className="mb-3 text-sm">{events.map((e) => <li key={e.id}>{formatDate(e.occurredAt)} : {formatKm(e.oldReadingKm)} → {formatKm(e.newReadingKm)} (décalage historisé)</li>)}</ul>}
        <form action={odometerReplacementAction} className="grid gap-3 sm:grid-cols-4">
          <input type="hidden" name="vehicleId" value={id} />
          <Field label="Date du remplacement" htmlFor="occurredAt-o"><Input id="occurredAt-o" name="occurredAt" type="date" required /></Field>
          <Field label="Ancien relevé (km)" htmlFor="oldReadingKm"><Input id="oldReadingKm" name="oldReadingKm" inputMode="numeric" required /></Field>
          <Field label="Nouveau relevé (km)" htmlFor="newReadingKm"><Input id="newReadingKm" name="newReadingKm" inputMode="numeric" required /></Field>
          <div className="flex items-end"><Button type="submit" variant="secondary">Déclarer</Button></div>
        </form>
      </Card>

      <Card title="Informations du véhicule">
        <form action={updateVehicleAction}>
          <input type="hidden" name="vehicleId" value={id} />
          <input type="hidden" name="version" value={vehicle.version} />
          <VehicleScan photoScan={ocrAvailable()} currentPhotoUrl={photoUrl} />
          <VehicleFields d={{ ...vehicle, tankCapacityL: vehicle.tankCapacityL ? Number(vehicle.tankCapacityL).toString() : "", initialOdometerKm: Number(vehicle.initialOdometerKm).toFixed(0) }} />
          <div className="mt-3 flex flex-wrap gap-2"><Button type="submit">Enregistrer</Button></div>
        </form>
        <form action={archiveVehicleAction} className="mt-3">
          <input type="hidden" name="vehicleId" value={id} />
          <input type="hidden" name="archived" value={vehicle.archivedAt ? "0" : "1"} />
          <Button type="submit" variant="secondary">{vehicle.archivedAt ? "Désarchiver" : "Archiver ce véhicule"}</Button>
        </form>
      </Card>
    </div>
  );
}
