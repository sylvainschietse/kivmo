import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { requireOrgPage } from "@/server/org-page";
import { listInvitations, listMembers, orgRole, ROLE_LABELS } from "@/server/services/organizations";
import { formatDate } from "@/lib/format";
import { Badge, Button, Card, ErrorFromQuery, Field, Input, Notice, OkFromQuery, Select, Table } from "@/components/ui";
import { createTeamAction, inviteMemberAction, removeMemberAction, revokeInvitationAction } from "@/app/actions/organizations";

export default async function Members({ params, searchParams }: { params: Promise<{ orgId: string }>; searchParams: Promise<{ ok?: string; erreur?: string; lien?: string }> }) {
  const { orgId } = await params;
  const q = await searchParams;
  const { ctx } = await requireOrgPage(orgId);
  const db = getDb();
  const role = await orgRole(db, ctx, orgId);
  const admin = role === "owner" || role === "fleet_admin";
  const members = await listMembers(db, ctx, orgId);
  const invitations = admin ? await listInvitations(db, ctx, orgId) : [];
  const teams = await db.select().from(schema.teams).where(eq(schema.teams.organizationId, orgId));
  return (
    <div className="space-y-4">
      <OkFromQuery ok={q.ok} />
      <ErrorFromQuery error={q.erreur} />
      {q.lien && <Notice tone="info" title="Lien d'invitation (valable 7 jours)"><code className="break-all text-xs">{q.lien}</code></Notice>}
      <Card title="Membres">
        <Table
          head={["Membre", "Rôle", "Équipe", ""]}
          rows={members.map((m) => [
            m.displayName ?? m.email,
            ROLE_LABELS[m.membership.role],
            teams.find((t) => t.id === m.membership.teamId)?.name ?? "—",
            admin && m.membership.userId !== ctx.userId && m.membership.role !== "owner" ? (
              <form key="r" action={removeMemberAction}><input type="hidden" name="organizationId" value={orgId} /><input type="hidden" name="userId" value={m.membership.userId} /><button className="tap text-sm font-semibold text-loss underline">Retirer</button></form>
            ) : "",
          ])}
        />
      </Card>
      {admin && (
        <>
          <Card title="Inviter">
            <form action={inviteMemberAction} className="grid gap-3 sm:grid-cols-3">
              <input type="hidden" name="organizationId" value={orgId} />
              <Field label="E-mail" htmlFor="email"><Input id="email" name="email" type="email" required autoComplete="off" /></Field>
              <Field label="Rôle" htmlFor="role"><Select id="role" name="role" defaultValue="driver">{(["fleet_admin", "manager", "driver", "accountant"] as const).map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</Select></Field>
              <div className="flex items-end"><Button type="submit">Envoyer l&apos;invitation</Button></div>
            </form>
            {invitations.length > 0 && (
              <ul className="mt-3 space-y-1 text-sm">
                {invitations.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center gap-2">
                    {i.email} · {ROLE_LABELS[i.role as keyof typeof ROLE_LABELS]} · expire le {formatDate(i.expiresAt)}
                    {i.acceptedAt ? <Badge tone="gain">Acceptée</Badge> : i.revokedAt ? <Badge>Révoquée</Badge> : i.expiresAt < new Date() ? <Badge tone="warn">Expirée</Badge> : (
                      <form action={revokeInvitationAction}><input type="hidden" name="organizationId" value={orgId} /><input type="hidden" name="invitationId" value={i.id} /><button className="tap text-sm font-semibold text-loss underline">Révoquer</button></form>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Équipes et centres de coûts">
            {teams.length > 0 && <p className="mb-2 text-sm">{teams.map((t) => `${t.name} (${t.kind})`).join(", ")}</p>}
            <form action={createTeamAction} className="grid gap-3 sm:grid-cols-3">
              <input type="hidden" name="organizationId" value={orgId} />
              <Field label="Nom" htmlFor="tname"><Input id="tname" name="name" required /></Field>
              <Field label="Type" htmlFor="tkind"><Select id="tkind" name="kind"><option value="equipe">Équipe</option><option value="centre_de_couts">Centre de coûts</option><option value="site">Site</option></Select></Field>
              <div className="flex items-end"><Button type="submit" variant="secondary">Créer</Button></div>
            </form>
          </Card>
        </>
      )}
    </div>
  );
}
