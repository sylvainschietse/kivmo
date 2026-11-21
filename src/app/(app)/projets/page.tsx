import Link from "next/link";
import { getDb } from "@/db/client";
import { requireSession } from "@/server/session";
import { projectFigures, savingsOverview } from "@/server/services/savings";
import { D } from "@/lib/decimal";
import { formatDate, formatMoney, formatSignedMoney } from "@/lib/format";
import { progressRatio } from "@/domain/savings";
import { Badge, Button, Card, EmptyState, ErrorFromQuery, Field, Input, LinkButton, Notice, OkFromQuery, PageHeader, Stat } from "@/components/ui";
import { allocateAction, archiveProjectAction, createProjectAction, declareTransferAction, updateSharesAction } from "@/app/actions/savings";
import { dayInZone } from "@/lib/dates";

export const metadata = { title: "Projets et épargne" };

export default async function Projets({ searchParams }: { searchParams: Promise<{ ok?: string; erreur?: string }> }) {
  const q = await searchParams;
  const { ctx } = await requireSession();
  const db = getDb();
  const ov = await savingsOverview(db, ctx);
  const projects = await projectFigures(db, ctx);
  const today = dayInZone(new Date());
  const totals = projects.reduce(
    (a, p) => ({ allocated: a.allocated.plus(p.figures.allocated), declared: a.declared.plus(p.figures.declaredManual), confirmed: a.confirmed.plus(p.figures.bankConfirmed) }),
    { allocated: D(0), declared: D(0), confirmed: D(0) },
  );

  return (
    <div className="space-y-4">
      <PageHeader title="Projets et épargne" subtitle="Les gains calculés ne sont pas de l'argent sur un compte : ils deviennent de l'épargne réelle seulement après un virement." action={<LinkButton href="/projets/epargne" variant="secondary">Banque et virements</LinkButton>} />
      <OkFromQuery ok={q.ok} />
      <ErrorFromQuery error={q.erreur} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card><Stat label="1. Économie calculée" value={formatSignedMoney(ov.gains.calculatedGains)} tone={ov.gains.calculatedGains.lt(0) ? "loss" : "gain"} hint={ov.deductConversion ? `Conversion déduite : ${formatMoney(ov.gains.conversionCost)}` : "Conversion non déduite"} /></Card>
        <Card><Stat label="2. Affecté aux projets" value={formatMoney(totals.allocated)} hint="Affectation logique, aucun argent déplacé" /></Card>
        <Card><Stat label="3. Virements déclarés" value={formatMoney(totals.declared)} hint="Déclarés par vous, non vérifiés" /></Card>
        <Card><Stat label="4. Confirmé par la banque" value={formatMoney(totals.confirmed)} hint="Uniquement après confirmation du prestataire" /></Card>
      </div>

      <Card title="Gains disponibles">
        <p className="num text-2xl font-bold">{formatMoney(ov.capacity.capacity)}</p>
        <p className="text-sm text-muted">{ov.capacity.message}</p>
        {ov.capacity.deficit.gt(0) && <Notice tone="loss" title="Pertes à rattraper">{formatMoney(ov.capacity.deficit)} de pertes ou de coût de conversion à compenser avant toute nouvelle affectation. Votre épargne déjà versée n&apos;est jamais reprise.</Notice>}
        {ov.gains.incompleteComparisons > 0 && <p className="mt-1 text-sm text-warn">{ov.gains.incompleteComparisons} comparaison(s) incomplète(s) non comptée(s).</p>}
        <form action={allocateAction} className="mt-3"><Button type="submit" disabled={ov.capacity.capacity.lt("0.01") || projects.length === 0}>Affecter aux projets selon la répartition</Button></form>
      </Card>

      {projects.length === 0 ? (
        <EmptyState title="Aucun projet">Créez un projet (vacances, entretien, épargne de précaution…) pour y affecter vos gains.</EmptyState>
      ) : (
        <form action={updateSharesAction}>
          <div className="grid gap-4 lg:grid-cols-2">
            {projects.map(({ project: p, figures: f, transferable }) => {
              const saved = f.bankConfirmed.plus(f.declaredManual);
              const ratio = progressRatio(saved, p.target ? D(p.target) : null);
              return (
                <Card key={p.id} title={<span>{p.emoji} {p.name} {p.isPrimary && <Badge tone="lime">Principal</Badge>}</span>}>
                  <input type="hidden" name="projectId" value={p.id} />
                  {p.target && (
                    <div className="mb-2">
                      <div className="h-3 w-full overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Number(ratio ?? 0) * 100)} aria-label={`Progression de ${p.name}`}>
                        <div className="h-full bg-green" style={{ width: `${Math.min(100, Number(ratio ?? 0) * 100)}%` }} />
                      </div>
                      <p className="mt-1 text-sm">{formatMoney(saved)} versés sur {formatMoney(p.target)}{p.targetDate ? ` · objectif le ${formatDate(p.targetDate)}` : ""}</p>
                    </div>
                  )}
                  <dl className="num grid grid-cols-2 gap-2 text-sm">
                    <div><dt className="text-muted">Affecté</dt><dd>{formatMoney(f.allocated)}</dd></div>
                    <div><dt className="text-muted">Reste à verser</dt><dd className="font-semibold">{formatMoney(transferable)}</dd></div>
                    <div><dt className="text-muted">Déclaré</dt><dd>{formatMoney(f.declaredManual)}</dd></div>
                    <div><dt className="text-muted">Confirmé banque</dt><dd>{formatMoney(f.bankConfirmed)}</dd></div>
                    {f.inFlight.gt(0) && <div className="col-span-2"><dt className="text-muted">Ordre en cours</dt><dd>{formatMoney(f.inFlight)}</dd></div>}
                  </dl>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <Field label="Part (%)" htmlFor={`pct-${p.id}`}><Input id={`pct-${p.id}`} name={`pct-${p.id}`} inputMode="decimal" defaultValue={p.sharePercent ? Number(p.sharePercent).toString() : ""} /></Field>
                    <Field label="ou montant fixe (€)" htmlFor={`fix-${p.id}`}><Input id={`fix-${p.id}`} name={`fix-${p.id}`} inputMode="decimal" defaultValue={p.shareFixedAmount ? Number(p.shareFixedAmount).toFixed(2) : ""} /></Field>
                  </div>
                </Card>
              );
            })}
          </div>
          <div className="mt-3"><Button type="submit" variant="secondary">Enregistrer la répartition</Button></div>
        </form>
      )}

      {projects.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Déclarer un virement fait vous-même">
            <form action={declareTransferAction} className="grid gap-3 sm:grid-cols-2">
              <Field label="Projet" htmlFor="projectId-d"><select id="projectId-d" name="projectId" className="tap w-full rounded-xl border border-line bg-surface px-3">{projects.map(({ project: p, transferable }) => <option key={p.id} value={p.id}>{p.name} (max {formatMoney(transferable)})</option>)}</select></Field>
              <Field label="Montant (€)" htmlFor="amount-d"><Input id="amount-d" name="amount" inputMode="decimal" required /></Field>
              <Field label="Date" htmlFor="occurredOn"><Input id="occurredOn" name="occurredOn" type="date" defaultValue={today} required /></Field>
              <Field label="Note" htmlFor="note-d"><Input id="note-d" name="note" /></Field>
              <div><Button type="submit">Déclarer</Button></div>
            </form>
            <p className="mt-2 text-xs text-muted">Une déclaration reste marquée « déclarée » : elle n&apos;est jamais présentée comme vérifiée par une banque.</p>
          </Card>
          <Card title="Archiver un projet">
            <form action={archiveProjectAction} className="flex flex-wrap items-end gap-2">
              <Field label="Projet" htmlFor="projectId-a"><select id="projectId-a" name="projectId" className="tap w-full rounded-xl border border-line bg-surface px-3">{projects.map(({ project: p }) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
              <Button type="submit" variant="secondary">Archiver</Button>
            </form>
          </Card>
        </div>
      )}

      <Card title="Nouveau projet">
        <form action={createProjectAction} className="grid gap-3 sm:grid-cols-3">
          <Field label="Nom" htmlFor="name"><Input id="name" name="name" required maxLength={80} /></Field>
          <Field label="Emoji (facultatif)" htmlFor="emoji"><Input id="emoji" name="emoji" maxLength={8} /></Field>
          <Field label="Objectif (€)" htmlFor="target"><Input id="target" name="target" inputMode="decimal" /></Field>
          <Field label="Date cible" htmlFor="targetDate"><Input id="targetDate" name="targetDate" type="date" /></Field>
          <Field label="Part des gains (%)" htmlFor="sharePercent"><Input id="sharePercent" name="sharePercent" inputMode="decimal" /></Field>
          <Field label="Priorité (1 à 5)" htmlFor="priority"><Input id="priority" name="priority" type="number" min={1} max={5} defaultValue={1} /></Field>
          <div><Button type="submit">Créer le projet</Button></div>
        </form>
        <p className="mt-2 text-xs text-muted">Option de déduction de la conversion : <Link className="underline" href="/profil#epargne">Profil</Link>.</p>
      </Card>
    </div>
  );
}
