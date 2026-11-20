import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { requireSession } from "@/server/session";
import { getPreferences, NOTIFICATION_KINDS } from "@/server/services/notifications";
import { formatDateTime } from "@/lib/format";
import { Badge, Button, Card, ErrorFromQuery, Field, Input, Notice, OkFromQuery, PageHeader, Select } from "@/components/ui";
import { ThemeSelect } from "@/components/theme-select";
import { InstallApp } from "@/components/install-app";
import { createReferralAction, deleteAccountAction, revokeConsentAction, updateNotificationPrefsAction, updateProfileAction } from "@/app/actions/profile";
import { logoutAction } from "@/app/actions/auth";

export const metadata = { title: "Profil et paramètres" };

const PURPOSES: Record<string, string> = { partage_partenaire: "Partage avec un professionnel", banque_initiation: "Initiation de virements", banque: "Connexion bancaire" };

export default async function Profil({ searchParams }: { searchParams: Promise<{ ok?: string; erreur?: string }> }) {
  const q = await searchParams;
  const { ctx, user } = await requireSession();
  const db = getDb();
  const [profile] = await db.select().from(schema.profiles).where(eq(schema.profiles.userId, ctx.userId));
  const prefs = await getPreferences(db, ctx.userId);
  const consents = await db.select().from(schema.consentRecords).where(eq(schema.consentRecords.userId, ctx.userId)).orderBy(desc(schema.consentRecords.grantedAt));
  const [ref] = await db.select().from(schema.referralEvents).where(eq(schema.referralEvents.referrerUserId, ctx.userId));
  const kinds = prefs.kinds as Record<string, boolean>;
  const ch = prefs.channels as { push: boolean; email: boolean };

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader title="Profil et paramètres" subtitle={ctx.isDemo ? "Compte de démonstration (supprimé automatiquement)" : user.email} />
      <OkFromQuery ok={q.ok} />
      <ErrorFromQuery error={q.erreur} />

      <Card title="Compte">
        <form action={updateProfileAction} className="grid gap-3 sm:grid-cols-2">
          <Field label="Nom affiché" htmlFor="displayName"><Input id="displayName" name="displayName" defaultValue={user.displayName ?? ""} maxLength={80} /></Field>
          <Field label="Type de compte" htmlFor="accountKind"><Select id="accountKind" name="accountKind" defaultValue={user.accountKind}><option value="particulier">Particulier</option><option value="independant">Indépendant</option><option value="entreprise">Entreprise</option></Select></Field>
          <Field label="Fuseau horaire" htmlFor="timeZone"><Input id="timeZone" name="timeZone" defaultValue={profile?.timeZone ?? "Europe/Paris"} /></Field>
          <Field label="Thème" htmlFor="theme"><ThemeSelect value={profile?.theme ?? "system"} /></Field>
          <Field label="Application de navigation" htmlFor="preferredNavApp"><Select id="preferredNavApp" name="preferredNavApp" defaultValue={profile?.preferredNavApp ?? "google"}><option value="google">Google Maps</option><option value="waze">Waze</option><option value="apple">Plans (Apple)</option><option value="osm">OpenStreetMap</option></Select></Field>
          <label id="epargne" className="flex items-start gap-2 text-sm sm:col-span-2"><input type="checkbox" name="deductConversion" value="1" defaultChecked={profile?.deductConversionBeforeAllocation ?? true} className="mt-0.5 h-5 w-5" /> Déduire le coût de conversion avant d&apos;affecter des gains aux projets (recommandé)</label>
          <div><Button type="submit">Enregistrer</Button></div>
        </form>
      </Card>

      <Card title="Application sur téléphone">
        <InstallApp />
      </Card>

      <Card title="Notifications">
        <form action={updateNotificationPrefsAction} className="space-y-3">
          <fieldset className="grid gap-2 sm:grid-cols-2">
            <legend className="mb-1 text-sm font-semibold">Je veux être prévenu pour</legend>
            {Object.entries(NOTIFICATION_KINDS).map(([k, l]) => <label key={k} className="flex items-center gap-2 text-sm"><input type="checkbox" name={`kind-${k}`} value="1" defaultChecked={kinds[k] !== false} className="h-5 w-5" /> {l}</label>)}
          </fieldset>
          <fieldset className="flex flex-wrap gap-4 text-sm">
            <legend className="mb-1 text-sm font-semibold">Canaux (dans l&apos;application : toujours)</legend>
            <label className="flex items-center gap-2"><input type="checkbox" name="push" value="1" defaultChecked={ch.push} className="h-5 w-5" /> Notifications push <Badge tone="warn">À connecter</Badge></label>
            <label className="flex items-center gap-2"><input type="checkbox" name="email" value="1" defaultChecked={ch.email} className="h-5 w-5" /> E-mail</label>
          </fieldset>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Silence de" htmlFor="quietStart"><Input id="quietStart" name="quietStart" type="time" defaultValue={prefs.quietStart ?? "21:00"} /></Field>
            <Field label="à" htmlFor="quietEnd"><Input id="quietEnd" name="quietEnd" type="time" defaultValue={prefs.quietEnd ?? "08:00"} /></Field>
            <Field label="Max par jour" htmlFor="maxPerDay"><Input id="maxPerDay" name="maxPerDay" type="number" min={1} max={20} defaultValue={prefs.maxPerDay} /></Field>
          </div>
          <Button type="submit">Enregistrer</Button>
        </form>
      </Card>

      <Card title="Consentements">
        {consents.length ? (
          <ul className="space-y-2 text-sm">
            {consents.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>{PURPOSES[c.purpose] ?? c.purpose} · {formatDateTime(c.grantedAt)} {c.revokedAt ? <Badge>Retiré</Badge> : <Badge tone="gain">Actif</Badge>}</span>
                {!c.revokedAt && <form action={revokeConsentAction}><input type="hidden" name="consentId" value={c.id} /><button className="tap text-sm font-semibold text-loss underline">Retirer</button></form>}
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-muted">Aucun consentement donné.</p>}
      </Card>

      <Card title="Parrainage">
        {ref ? <p className="text-sm">Votre code : <strong className="num">{ref.code}</strong>. Aucune donnée de la personne parrainée ne vous est communiquée.</p> : <form action={createReferralAction}><Button type="submit" variant="secondary">Obtenir mon code</Button></form>}
      </Card>

      <Card title="Mes données">
        <div className="flex flex-wrap gap-2">
          <a href="/api/account/export" className="tap inline-flex items-center rounded-xl bg-surface-2 px-4 text-sm font-semibold">Exporter toutes mes données (JSON)</a>
          <a href="/api/exports" className="tap inline-flex items-center rounded-xl bg-surface-2 px-4 text-sm font-semibold">Exporter mes pleins (CSV)</a>
        </div>
        <details className="mt-4">
          <summary className="tap cursor-pointer text-sm font-semibold text-loss">Supprimer mon compte</summary>
          <Notice tone="loss">Suppression définitive de vos véhicules personnels, pleins, projets, justificatifs et connexions. Les pleins saisis pour une entreprise restent à celle-ci, anonymisés.</Notice>
          <form action={deleteAccountAction} className="mt-2 flex flex-wrap items-end gap-2">
            <Field label="Tapez SUPPRIMER" htmlFor="confirm"><Input id="confirm" name="confirm" autoComplete="off" required /></Field>
            <Button type="submit" variant="danger">Supprimer définitivement</Button>
          </form>
        </details>
      </Card>

      <form action={logoutAction}><Button type="submit" variant="secondary">Se déconnecter</Button></form>
    </div>
  );
}
