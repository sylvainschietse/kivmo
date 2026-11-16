import { getDb } from "@/db/client";
import { requireSession } from "@/server/session";
import { getSavingsRule, listBankConnections, listPaymentOrders, projectFigures } from "@/server/services/savings";
import { integrations } from "@/integrations/registry";
import { env } from "@/server/env";
import { formatDateTime, formatMoney } from "@/lib/format";
import { PAYMENT_STATE_LABELS, BLOCKING_STATES } from "@/domain/payment-state";
import { Badge, Button, Card, EmptyState, ErrorFromQuery, Field, Input, IntegrationPill, Notice, OkFromQuery, PageHeader, Select } from "@/components/ui";
import { cancelOrderAction, connectBankAction, prepareOrderAction, reconcileAction, revokeBankAction, savingsRuleAction, savingsRuleStateAction, submitOrderAction } from "@/app/actions/savings";

export const metadata = { title: "Banque et virements" };

const TONE: Record<string, "gain" | "warn" | "loss" | "info" | "neutral"> = { confirmed: "gain", failed: "loss", cancelled: "neutral", unknown: "warn", draft: "info", to_authorize: "info", submitted: "info", pending: "info" };

export default async function Epargne({ searchParams }: { searchParams: Promise<{ ok?: string; erreur?: string }> }) {
  const q = await searchParams;
  const { ctx } = await requireSession();
  const db = getDb();
  const [connections, orders, projects, rule] = await Promise.all([listBankConnections(db, ctx), listPaymentOrders(db, ctx), projectFigures(db, ctx), getSavingsRule(db, ctx)]);
  const bank = integrations().find((i) => i.key === "bank");
  const active = connections.filter((c) => !c.revokedAt);
  const blocking = orders.find((o) => BLOCKING_STATES.includes(o.state));
  const sandbox = env.bankEnvironment === "sandbox";

  return (
    <div className="space-y-4">
      <PageHeader title="Banque et virements" subtitle="Initiation de virements vers vos comptes d'épargne, sous votre contrôle." action={bank ? <IntegrationPill status={bank.status} /> : null} />
      <OkFromQuery ok={q.ok} />
      <ErrorFromQuery error={q.erreur} />
      {sandbox ? (
        <Notice tone="warn" title="Bac à sable bancaire">Aucun prestataire bancaire réel n&apos;est connecté. Les connexions et virements ci-dessous sont <strong>fictifs</strong> : aucun argent ne bouge. Le vrai service est « À connecter » (prestataire agréé DSP2 requis).</Notice>
      ) : (
        <Notice tone="info">Prestataire bancaire de production configuré. Chaque virement exige votre autorisation forte auprès de votre banque.</Notice>
      )}

      <Card title="Connexions bancaires">
        {active.length ? (
          <ul className="space-y-2 text-sm">
            {active.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-surface-2 p-3">
                <span>
                  <strong>{c.accountLabel ?? "Compte"}</strong> {c.ibanMasked} <Badge tone={c.environment === "sandbox" ? "warn" : "gain"}>{c.environment === "sandbox" ? "Fictif" : "Réel"}</Badge>
                  <span className="block text-xs text-muted">Consentement jusqu&apos;au {c.consentExpiresAt ? formatDateTime(c.consentExpiresAt) : "—"} · lecture : {c.canReadTransactions ? "oui" : "non"} · initiation : {c.canInitiatePayments ? "oui" : "non"} · titulaire vérifié : {c.ownershipVerified ? "oui" : "non"}</span>
                </span>
                <form action={revokeBankAction}><input type="hidden" name="connectionId" value={c.id} /><Button variant="secondary" type="submit">Révoquer</Button></form>
              </li>
            ))}
          </ul>
        ) : (
          <form action={connectBankAction} className="space-y-3">
            <input type="hidden" name="consentVersion" value="2026-11" />
            <p className="text-sm">KIVMO demandera uniquement l&apos;initiation de virements vers un compte que vous désignez, pour 90 jours. Vous pouvez révoquer à tout moment.</p>
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="consent" value="1" required className="mt-0.5 h-5 w-5" /> J&apos;accepte de connecter {sandbox ? "la banque de démonstration (fictive)" : "ma banque"} pour initier des virements que j&apos;autoriserai un par un.</label>
            <Button type="submit">{sandbox ? "Connecter la banque fictive" : "Connecter ma banque"}</Button>
          </form>
        )}
      </Card>

      {active.length > 0 && projects.length > 0 && (
        <Card title="Préparer un virement">
          {blocking ? (
            <Notice tone="warn">Un ordre est en cours ({PAYMENT_STATE_LABELS[blocking.state]}) : aucun nouvel ordre tant qu&apos;il n&apos;est pas résolu.</Notice>
          ) : (
            <form action={prepareOrderAction} className="grid gap-3 sm:grid-cols-4">
              <input type="hidden" name="idempotencyKey" value={crypto.randomUUID()} />
              <input type="hidden" name="bankConnectionId" value={active[0].id} />
              <Field label="Projet" htmlFor="projectId"><Select id="projectId" name="projectId">{projects.map(({ project: p, transferable }) => <option key={p.id} value={p.id}>{p.name} (max {formatMoney(transferable)})</option>)}</Select></Field>
              <Field label="Montant (€)" htmlFor="amount"><Input id="amount" name="amount" inputMode="decimal" required /></Field>
              <div className="flex items-end"><Button type="submit">Préparer</Button></div>
            </form>
          )}
        </Card>
      )}

      <Card title="Ordres de virement" action={<form action={reconcileAction}><Button type="submit" variant="secondary">Rapprocher</Button></form>}>
        {orders.length ? (
          <div className="space-y-3">
            {orders.map((o) => {
              const p = projects.find((x) => x.project.id === o.projectId);
              return (
                <div key={o.id} className="rounded-xl border border-line p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span><strong className="num">{formatMoney(o.amount, o.currency)}</strong> vers {p?.project.name ?? "projet"} · {formatDateTime(o.createdAt)}</span>
                    <Badge tone={TONE[o.state]}>{PAYMENT_STATE_LABELS[o.state]}</Badge>
                  </div>
                  {o.lastError && <p className="mt-1 text-warn">{o.lastError}</p>}
                  {o.feesNotice && <p className="mt-1 text-muted">{o.feesNotice}</p>}
                  {o.state === "draft" && (
                    <form action={submitOrderAction} className="mt-2 space-y-2">
                      <input type="hidden" name="orderId" value={o.id} />
                      <label className="flex items-start gap-2"><input type="checkbox" name="consent" value="1" required className="mt-0.5 h-5 w-5" /> Je confirme ce virement de {formatMoney(o.amount)} ; je l&apos;autoriserai auprès de la banque.</label>
                      {sandbox && (
                        <Field label="Scénario de démonstration" htmlFor={`sc-${o.id}`}><Select id={`sc-${o.id}`} name="scenario"><option value="ok">Réponse normale</option><option value="timeout">Délai dépassé (statut incertain)</option><option value="fail">Refus de la banque</option></Select></Field>
                      )}
                      <div className="flex flex-wrap gap-2"><Button type="submit">Soumettre</Button></div>
                    </form>
                  )}
                  {o.state === "to_authorize" && o.authorizationUrl && <a href={o.authorizationUrl} className="tap mt-2 inline-flex items-center font-semibold text-green underline">Autoriser auprès de la banque</a>}
                  {["draft", "to_authorize"].includes(o.state) && (
                    <form action={cancelOrderAction} className="mt-2"><input type="hidden" name="orderId" value={o.id} /><Button type="submit" variant="secondary">Annuler</Button></form>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState title="Aucun ordre">Préparez un virement depuis un projet pour verser réellement vos gains.</EmptyState>
        )}
      </Card>

      <Card title="Règle d'épargne">
        {rule && <p className="mb-2 text-sm">Règle actuelle : {rule.mode === "prepare" ? "préparer les ordres" : "manuelle"}, {rule.frequency}, seuil {formatMoney(rule.minimumAmount)}{rule.capAmount ? `, plafond ${formatMoney(rule.capAmount)}` : ""}. {rule.stoppedAt ? <Badge tone="neutral">Arrêtée</Badge> : rule.pausedAt ? <Badge tone="warn">En pause</Badge> : <Badge tone="gain">Active</Badge>}</p>}
        <form action={savingsRuleAction} className="grid gap-3 sm:grid-cols-4">
          <Field label="Mode" htmlFor="mode"><Select id="mode" name="mode" defaultValue={rule?.mode ?? "manuel"}><option value="manuel">Manuel</option><option value="prepare">Préparer les ordres, je valide</option><option value="automatique">Automatique (À connecter)</option></Select></Field>
          <Field label="Fréquence" htmlFor="frequency"><Select id="frequency" name="frequency" defaultValue={rule?.frequency ?? "mensuelle"}><option value="hebdomadaire">Hebdomadaire</option><option value="mensuelle">Mensuelle</option></Select></Field>
          <Field label="Seuil minimal (€)" htmlFor="minimumAmount"><Input id="minimumAmount" name="minimumAmount" inputMode="decimal" defaultValue={rule ? Number(rule.minimumAmount).toFixed(2) : "10"} /></Field>
          <Field label="Plafond (€)" htmlFor="capAmount"><Input id="capAmount" name="capAmount" inputMode="decimal" defaultValue={rule?.capAmount ? Number(rule.capAmount).toFixed(2) : ""} /></Field>
          <div><Button type="submit">Enregistrer</Button></div>
        </form>
        {rule && (
          <div className="mt-3 flex flex-wrap gap-2">
            {(["pause", "reprise", "arret"] as const).map((s) => (
              <form key={s} action={savingsRuleStateAction}><input type="hidden" name="state" value={s} /><Button type="submit" variant="secondary">{s === "pause" ? "Mettre en pause" : s === "reprise" ? "Reprendre" : "Arrêter"}</Button></form>
            ))}
          </div>
        )}
        <p className="mt-2 text-xs text-muted">L&apos;épargne automatique exige un prestataire et une banque qui permettent ce mécanisme ; elle reste indisponible tant qu&apos;ils ne sont pas connectés.</p>
      </Card>
    </div>
  );
}
