import Link from "next/link";
import { getDb } from "@/db/client";
import { requireSession } from "@/server/session";
import { homeData } from "@/server/services/dashboard";
import { formatConsumption, formatDate, formatKm, formatLiters, formatMoney, formatSignedMoney } from "@/lib/format";
import { Badge, Card, EmptyState, ErrorFromQuery, LinkButton, Notice, OkFromQuery, Select, Stat } from "@/components/ui";
import { setActiveVehicleAction } from "@/app/actions/vehicles";
import { ISSUE_MESSAGES } from "@/domain/consumption";
import { progressRatio } from "@/domain/savings";
import { InstallApp } from "@/components/install-app";

export const metadata = { title: "Accueil" };

export default async function Accueil({ searchParams }: { searchParams: Promise<{ ok?: string; erreur?: string }> }) {
  const { ctx, user } = await requireSession();
  const q = await searchParams;
  const h = await homeData(getDb(), ctx);
  const s = h.summary;

  if (!s) {
    return (
      <div className="space-y-4">
        <OkFromQuery ok={q.ok} />
        <h1 className="text-2xl font-bold">Bonjour{user.displayName ? `, ${user.displayName}` : ""}</h1>
        <EmptyState title="Ajoutez votre véhicule pour commencer" action={<LinkButton href="/onboarding">Configurer mon véhicule</LinkButton>}>
          Aucune donnée pour l&apos;instant : aucun total n&apos;est affiché tant que vous n&apos;avez rien saisi.
        </EmptyState>
      </div>
    );
  }

  const tz = h.timeZone;
  const last = s.lastInterval;
  const cmp = s.lastComparison;
  const am = s.amortization;
  const gainTone = s.measuredGainTotal.gt(0) ? "gain" : s.measuredGainTotal.lt(0) ? "loss" : "neutral";
  const proj = h.primaryProject;
  const saved = proj ? proj.figures.bankConfirmed.plus(proj.figures.declaredManual) : null;
  const ratio = proj && saved ? progressRatio(saved, proj.project.target ? (await import("@/lib/decimal")).D(proj.project.target) : null) : null;

  return (
    <div className="space-y-4">
      <OkFromQuery ok={q.ok} />
      <ErrorFromQuery error={q.erreur} />
      <InstallApp dismissible />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-muted">Véhicule actif</p>
          {h.vehicles.length > 1 ? (
            <form action={setActiveVehicleAction} className="flex gap-2">
              <label htmlFor="vehicleId" className="sr-only">Changer de véhicule</label>
              <Select id="vehicleId" name="vehicleId" defaultValue={s.vehicle.id} className="max-w-xs font-semibold">
                {h.vehicles.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </Select>
              <button className="tap rounded-xl bg-surface-2 px-3 text-sm font-semibold">Changer</button>
            </form>
          ) : (
            <h1 className="text-2xl font-bold">{s.vehicle.name}</h1>
          )}
        </div>
        <LinkButton href="/pleins/nouveau" variant="lime">Ajouter un plein</LinkButton>
      </div>

      {s.fillupCount === 0 && (
        <Notice tone="info" title="Premier plein">
          Faites un <strong>plein complet</strong> et enregistrez-le : il servira de point de départ. La consommation sera mesurée au plein complet suivant.
        </Notice>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card><Stat label="Dépenses du mois" value={formatMoney(h.monthSpend, s.vehicle.currency)} hint={`${h.monthFillupCount} plein(s) · par date d'achat`} /></Card>
        <Card>
          <Stat
            label="Économie calculée"
            value={s.hasReference ? formatSignedMoney(s.measuredGainTotal) : "—"}
            tone={gainTone}
            toneLabel={!s.hasReference ? undefined : s.measuredGainTotal.lt(0) ? "Perte face à la référence" : s.measuredGainTotal.gt(0) ? "Économie face à la référence" : undefined}
            hint={s.hasReference ? `Intervalles mesurés et complets${s.incompleteComparisons ? ` · ${s.incompleteComparisons} comparaison(s) incomplète(s)` : ""}` : <Link className="underline" href={`/garage/${s.vehicle.id}`}>Définir une référence</Link>}
          />
        </Card>
        <Card>
          <Stat
            label="Consommation mesurée"
            value={last?.status === "measured" ? formatConsumption(last.consumptionL100) : "—"}
            hint={last?.status === "measured" ? `${formatKm(last.distanceKm)} · clos le ${formatDate(last.closedAt, tz)}${s.averageL100 ? ` · moyenne ${formatConsumption(s.averageL100)}` : ""}` : s.headline}
          />
        </Card>
        <Card>
          {am ? (
            <Stat
              label="Amortissement conversion"
              value={am.currentlyAmortized ? "Amortie" : formatMoney(am.remainingToAmortize)}
              tone={am.currentlyAmortized ? "gain" : "warn"}
              toneLabel={am.currentlyAmortized ? `Gain net ${formatSignedMoney(am.netAfterConversion)}` : "Reste à amortir"}
              hint={`Coût ${formatMoney(am.conversionCost)} · gains cumulés ${formatSignedMoney(am.cumulativeGain)}${am.initialAmortizedAt ? ` · amortie une première fois le ${formatDate(am.initialAmortizedAt, tz)}` : ""}`}
            />
          ) : (
            <Stat label="Amortissement conversion" value="—" hint={<Link className="underline" href={`/garage/${s.vehicle.id}#conversion`}>Déclarer une conversion</Link>} />
          )}
        </Card>
      </div>

      {(s.measuredGainTotal.lt(0) || s.incompleteComparisons > 0 || (last && last.status !== "measured") || (am && am.straddlingIntervalIds.length > 0)) && (
        <Notice tone="warn" title="Comprendre vos résultats">
          <ul className="list-disc space-y-1 pl-5">
            {s.measuredGainTotal.lt(0) && <li>Sur les intervalles mesurés, vous dépensez plus que la référence : le total diminue et la perte est affichée telle quelle.</li>}
            {s.incompleteComparisons > 0 && <li>{s.incompleteComparisons} intervalle(s) sans comparaison complète (prix de référence manquant ou mesure suspecte) : ils ne comptent pas dans l&apos;économie.</li>}
            {last && last.status !== "measured" && <li>{ISSUE_MESSAGES[last.issues[0]]}</li>}
            {am && am.straddlingIntervalIds.length > 0 && <li>Un intervalle chevauche la date de conversion : enregistrez un nouveau plein complet de repère pour qu&apos;il soit pris en compte.</li>}
          </ul>
        </Notice>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Dernier intervalle" className="lg:col-span-2" action={<Link href="/analyses" className="text-sm font-semibold text-green underline">Analyses</Link>}>
          {last ? (
            <dl className="num grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <div><dt className="text-muted">Distance</dt><dd className="font-semibold">{formatKm(last.distanceKm)}</dd></div>
              <div><dt className="text-muted">Volume</dt><dd className="font-semibold">{formatLiters(last.volumeL)}</dd></div>
              <div><dt className="text-muted">Coût</dt><dd className="font-semibold">{formatMoney(last.cost)}</dd></div>
              <div><dt className="text-muted">Coût / 100 km</dt><dd className="font-semibold">{last.costPer100 ? formatMoney(last.costPer100) : "—"}</dd></div>
              {cmp && (
                <div className="col-span-2 sm:col-span-4">
                  <dt className="text-muted">Comparaison</dt>
                  <dd>
                    {cmp.status === "complete" ? (
                      <>Référence {formatMoney(cmp.referenceCost)} → <strong className={cmp.gain!.lt(0) ? "text-loss" : "text-green"}>{formatSignedMoney(cmp.gain!)}</strong> <span className="text-muted">({cmp.priceMethod})</span></>
                    ) : (
                      <span className="text-warn">{cmp.missingReason}</span>
                    )}
                  </dd>
                </div>
              )}
              <p className="col-span-2 text-xs text-muted sm:col-span-4">Coût = achats de remplacement sur l&apos;intervalle (convention), pas une mesure physique du carburant restant.</p>
            </dl>
          ) : (
            <p className="text-sm text-muted">{s.headline}</p>
          )}
        </Card>
        <Card title="Projet principal" action={<Link href="/projets" className="text-sm font-semibold text-green underline">Projets</Link>}>
          {proj ? (
            <div className="space-y-2 text-sm">
              <p className="text-lg font-bold">{proj.project.emoji} {proj.project.name}</p>
              {ratio && (
                <div className="h-3 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={Math.round(ratio.toNumber() * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Progression réellement mise de côté">
                  <div className="h-full bg-green" style={{ width: `${ratio.times(100).toFixed(1)}%` }} />
                </div>
              )}
              <dl className="num grid grid-cols-2 gap-2">
                <div><dt className="text-muted">Affecté (théorique)</dt><dd className="font-semibold">{formatMoney(proj.figures.allocated)}</dd></div>
                <div><dt className="text-muted">Réellement mis de côté</dt><dd className="font-semibold">{formatMoney(saved)}</dd></div>
              </dl>
              {proj.figures.declaredManual.gt(0) && <p className="text-xs text-muted">Dont {formatMoney(proj.figures.declaredManual)} déclarés manuellement (non vérifiés par la banque).</p>}
              {proj.figures.inFlight.gt(0) && <Badge tone="info">Virement en attente de confirmation : {formatMoney(proj.figures.inFlight)}</Badge>}
            </div>
          ) : (
            <EmptyState title="Aucun projet" action={<LinkButton href="/projets" variant="secondary">Créer un projet</LinkButton>} />
          )}
        </Card>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card title="Dernier plein">
          {s.lastFillup ? (
            <Link href={`/pleins/${s.lastFillup.id}`} className="block text-sm">
              <p className="font-semibold">{formatDate(s.lastFillup.occurredAt, tz)} · {formatMoney(s.lastFillup.totalPaid)} · {formatLiters(s.lastFillup.liters)}</p>
              <p className="text-muted">{s.lastFillup.isFull ? "Plein complet" : "Plein partiel"} · {formatKm(s.lastFillup.odometerKm)}{s.lastFillup.stationLabel ? ` · ${s.lastFillup.stationLabel}` : ""}</p>
              {s.pendingCount > 0 && <p className="text-muted">En attente du prochain plein complet pour mesurer la consommation.</p>}
            </Link>
          ) : (
            <p className="text-sm text-muted">Aucun plein enregistré.</p>
          )}
          <div className="mt-3"><Link href="/historique" className="text-sm font-semibold text-green underline">Tout l&apos;historique</Link></div>
        </Card>
        <Card title="Stations">
          <p className="text-sm text-muted">Trouvez les stations proches et leurs prix datés. La position n&apos;est demandée qu&apos;au moment de la recherche.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <LinkButton href="/stations" variant="secondary">Voir les stations</LinkButton>
            <LinkButton href="/trajets" variant="ghost">Calculer un détour</LinkButton>
          </div>
        </Card>
      </div>
    </div>
  );
}
