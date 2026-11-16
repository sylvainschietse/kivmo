import Link from "next/link";
import { getDb } from "@/db/client";
import { requireSession } from "@/server/session";
import { getFillup } from "@/server/services/fillups";
import { vehicleSummary } from "@/server/services/dashboard";
import { attachmentUrl } from "@/server/services/attachments";
import { isInClosedPeriod } from "@/server/services/periods";
import { orgRole } from "@/server/services/organizations";
import { AppError } from "@/server/errors";
import { D, sum } from "@/lib/decimal";
import { formatConsumption, formatDateTime, formatKm, formatLiters, formatMoney, formatSignedMoney, formatUnitPrice } from "@/lib/format";
import { FUEL_LABELS, FUELS, type FuelCode } from "@/domain/types";
import { ISSUE_MESSAGES } from "@/domain/consumption";
import { Badge, Button, Card, EmptyState, ErrorFromQuery, Field, Input, LinkButton, Notice, OkFromQuery, PageHeader, Select } from "@/components/ui";
import { deleteFillupAction, decideFillupAction, updateFillupAction } from "@/app/actions/fillups";

const APPROVAL: Record<string, [string, "gain" | "warn" | "loss" | "info" | "neutral"]> = {
  not_required: ["Personnel", "neutral"],
  submitted: ["Soumis à validation", "info"],
  to_complete: ["À compléter", "warn"],
  validated: ["Validé", "gain"],
  rejected: ["Rejeté", "loss"],
};

export default async function PleinDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; erreur?: string; nouveau?: string }> }) {
  const { id } = await params;
  const q = await searchParams;
  const { ctx } = await requireSession();
  const db = getDb();
  let data;
  try {
    data = await getFillup(db, ctx, id);
  } catch (e) {
    if (e instanceof AppError) return <EmptyState title="Plein introuvable">Ce plein n&apos;existe pas ou vous n&apos;avez pas les droits pour le consulter.</EmptyState>;
    throw e;
  }
  const { fillup: f, vehicle, lines } = data;
  const s = await vehicleSummary(db, ctx, vehicle.id);
  const interval = s.intervals.find((i) => i.includedFillupIds.includes(f.id));
  const cmp = interval ? s.comparisons.find((c) => c.intervalEndFillupId === interval.endFillupId) : null;
  const isBaseline = s.intervals.length === 0 ? f.isFull : s.intervals[0]?.startFillupId === f.id;
  const receiptUrl = f.receiptAttachmentId ? await attachmentUrl(db, ctx, f.receiptAttachmentId).catch(() => null) : null;
  const closed = vehicle.organizationId ? await isInClosedPeriod(db, vehicle.organizationId, f.occurredAt) : false;
  const role = vehicle.organizationId ? await orgRole(db, ctx, vehicle.organizationId) : null;
  const canDecide = role && ["owner", "fleet_admin", "manager"].includes(role);
  const isAdmin = role && ["owner", "fleet_admin"].includes(role);
  const liters = sum(lines.map((l) => D(l.liters)));
  const local = new Date(f.occurredAt.getTime() - f.occurredAt.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader title={q.nouveau ? "Plein enregistré" : "Détail du plein"} subtitle={`${vehicle.name} · ${formatDateTime(f.occurredAt)}`} action={<LinkButton href="/pleins/nouveau" variant="lime">Nouveau plein</LinkButton>} />
      <OkFromQuery ok={q.ok} />
      <ErrorFromQuery error={q.erreur} />

      <Card title="Récapitulatif">
        <dl className="num grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div><dt className="text-muted">Montant payé</dt><dd className="text-lg font-bold">{formatMoney(f.totalPaid, f.currency)}</dd></div>
          <div><dt className="text-muted">Volume</dt><dd className="font-semibold">{formatLiters(liters)}</dd></div>
          <div><dt className="text-muted">Compteur</dt><dd className="font-semibold">{formatKm(f.odometerKm)}</dd></div>
          <div><dt className="text-muted">Type</dt><dd className="font-semibold">{f.isFull ? "Complet" : "Partiel"}</dd></div>
          {lines.map((l) => (
            <div key={l.id} className="col-span-2"><dt className="text-muted">{FUEL_LABELS[l.fuel as FuelCode]}</dt><dd>{formatLiters(l.liters)} · {formatUnitPrice(l.displayedUnitPrice)} · {formatMoney(l.amountPaid)}</dd></div>
          ))}
          {D(f.discount).gt(0) && <div><dt className="text-muted">Remise</dt><dd>{formatMoney(f.discount)}</dd></div>}
          {f.stationLabel && <div className="col-span-2"><dt className="text-muted">Station</dt><dd>{f.stationLabel}</dd></div>}
          <div className="col-span-2"><dt className="text-muted">Prix de référence (instantané)</dt><dd>{f.refPrice ? `${formatUnitPrice(f.refPrice)} · ${f.refPriceSource}` : "Aucun (prix fixe de scénario ou comparaison incomplète)"}</dd></div>
        </dl>
        <div className="mt-3 flex flex-wrap gap-2">
          {vehicle.organizationId && <Badge tone={APPROVAL[f.approvalStatus][1]}>{APPROVAL[f.approvalStatus][0]}</Badge>}
          {f.approvalReason && <Badge tone="warn">Motif : {f.approvalReason}</Badge>}
          {f.source === "demo" && <Badge tone="lime">Donnée de démonstration</Badge>}
          {closed && <Badge tone="warn">Période clôturée</Badge>}
          {receiptUrl ? <a className="text-sm font-semibold text-green underline" href={receiptUrl} target="_blank" rel="noreferrer">Voir le ticket (lien temporaire)</a> : <span className="text-sm text-muted">Aucun ticket joint</span>}
        </div>
      </Card>

      <Card title="Effet sur vos calculs">
        {isBaseline && !interval ? (
          <p className="text-sm">Premier plein : point de départ enregistré. Il n&apos;est pas attribué aux kilomètres futurs ; la consommation sera mesurée au prochain plein complet.</p>
        ) : interval ? (
          <div className="space-y-2 text-sm">
            {interval.status === "measured" ? (
              <p>Intervalle {formatKm(interval.startOdometerKm)} → {formatKm(interval.endOdometerKm)} : <strong>{formatConsumption(interval.consumptionL100)}</strong>, {formatMoney(interval.costPer100)} / 100 km.</p>
            ) : (
              <Notice tone="warn">{interval.issues.map((i) => ISSUE_MESSAGES[i]).join(" ")}</Notice>
            )}
            {cmp && (cmp.status === "complete" ? <p>Comparaison : référence {formatMoney(cmp.referenceCost)} → <strong className={cmp.gain!.lt(0) ? "text-loss" : "text-green"}>{formatSignedMoney(cmp.gain!)}</strong> ({cmp.gain!.lt(0) ? "perte" : "économie calculée"}).</p> : <p className="text-warn">{cmp.missingReason}</p>)}
            {s.amortization && <p>Conversion : {s.amortization.currentlyAmortized ? "amortie" : `reste à amortir ${formatMoney(s.amortization.remainingToAmortize)}`}.</p>}
            {!f.isFull && <p className="text-muted">Plein partiel : inclus dans l&apos;intervalle fermé par le prochain plein complet.</p>}
          </div>
        ) : (
          <p className="text-sm text-muted">{f.isFull ? "En attente du prochain plein complet." : "Plein partiel en attente du prochain plein complet."}</p>
        )}
        <p className="mt-2 text-xs text-muted">Projets : l&apos;économie calculée n&apos;est pas de l&apos;argent sur un compte. <Link className="underline" href="/projets">Affecter les gains</Link></p>
      </Card>

      {canDecide && f.approvalStatus !== "not_required" && (
        <Card title="Validation">
          <form action={decideFillupAction} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="fillupId" value={f.id} />
            <Field label="Motif (obligatoire pour rejet ou complément)" htmlFor="reason"><Input id="reason" name="reason" /></Field>
            <Button name="decision" value="validated">Valider</Button>
            <Button name="decision" value="to_complete" variant="secondary">À compléter</Button>
            <Button name="decision" value="rejected" variant="danger">Rejeter</Button>
          </form>
        </Card>
      )}

      <Card title="Corriger">
        {closed && !isAdmin ? (
          <Notice tone="warn">Période clôturée : seule une correction par un administrateur, motivée et tracée, est possible.</Notice>
        ) : (
          <form action={updateFillupAction} className="space-y-3">
            <input type="hidden" name="fillupId" value={f.id} />
            <input type="hidden" name="version" value={f.version} />
            <input type="hidden" name="lineCount" value={lines.length} />
            {closed && <input type="hidden" name="closedPeriodCorrection" value="1" />}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Date et heure" htmlFor="occurredAt"><Input id="occurredAt" name="occurredAt" type="datetime-local" defaultValue={local} /></Field>
              <Field label="Compteur (km)" htmlFor="odometerKm"><Input id="odometerKm" name="odometerKm" inputMode="numeric" defaultValue={Number(f.odometerKm).toFixed(0)} /></Field>
              <Field label="Type" htmlFor="isFull"><Select id="isFull" name="isFull" defaultValue={f.isFull ? "1" : "0"}><option value="1">Complet</option><option value="0">Partiel</option></Select></Field>
              <Field label="Usage" htmlFor="usage"><Select id="usage" name="usage" defaultValue={f.usage}><option value="personnel">Personnel</option><option value="professionnel">Professionnel</option><option value="mixte">Mixte</option></Select></Field>
              <Field label="Station" htmlFor="stationLabel"><Input id="stationLabel" name="stationLabel" defaultValue={f.stationLabel ?? ""} /></Field>
              <Field label="Prix de référence (€/L)" htmlFor="referencePrice" hint="Complète une comparaison incomplète."><Input id="referencePrice" name="referencePrice" inputMode="decimal" /></Field>
            </div>
            {lines.map((l, i) => (
              <div key={l.id} className="grid grid-cols-3 gap-2">
                <Field label="Carburant" htmlFor={`fuel-${i}`}><Select id={`fuel-${i}`} name={`fuel-${i}`} defaultValue={l.fuel}>{FUELS.map((x) => <option key={x} value={x}>{FUEL_LABELS[x]}</option>)}</Select></Field>
                <Field label="Litres" htmlFor={`liters-${i}`}><Input id={`liters-${i}`} name={`liters-${i}`} inputMode="decimal" defaultValue={Number(l.liters).toString().replace(".", ",")} /></Field>
                <Field label="Montant payé (€)" htmlFor={`amount-${i}`}><Input id={`amount-${i}`} name={`amount-${i}`} inputMode="decimal" defaultValue={Number(l.amountPaid).toFixed(2).replace(".", ",")} /></Field>
              </div>
            ))}
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="missedBefore" value="1" defaultChecked={f.missedBefore} className="h-5 w-5" /> Un achat a été oublié avant celui-ci</label>
            <Field label={closed ? "Motif de la correction (obligatoire, journalisé)" : "Motif (facultatif, journalisé)"} htmlFor="correctionReason"><Input id="correctionReason" name="correctionReason" required={closed} /></Field>
            <Button type="submit">Enregistrer la correction</Button>
          </form>
        )}
      </Card>

      {!closed && (
        <Card title="Supprimer">
          <form action={deleteFillupAction} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="fillupId" value={f.id} />
            <Field label="Motif de suppression" htmlFor="reason-del"><Input id="reason-del" name="reason" placeholder="Saisie en double…" /></Field>
            <Button type="submit" variant="danger">Supprimer ce plein</Button>
          </form>
          <p className="mt-2 text-xs text-muted">La suppression est tracée dans le journal ; les intervalles voisins sont recalculés.</p>
        </Card>
      )}
    </div>
  );
}
