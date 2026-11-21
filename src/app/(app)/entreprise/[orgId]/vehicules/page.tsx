import Link from "next/link";
import { and, inArray, isNull } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { requireOrgPage } from "@/server/org-page";
import { listMembers, orgRole } from "@/server/services/organizations";
import { listVehicles } from "@/server/services/vehicles";
import { formatDate, formatKm } from "@/lib/format";
import { Badge, Button, Card, EmptyState, ErrorFromQuery, Field, Input, LinkButton, OkFromQuery, Select } from "@/components/ui";
import { assignVehicleAction, endAssignmentAction } from "@/app/actions/organizations";
import { dayInZone } from "@/lib/dates";

export default async function OrgVehicles({ params, searchParams }: { params: Promise<{ orgId: string }>; searchParams: Promise<{ ok?: string; erreur?: string }> }) {
  const { orgId } = await params;
  const q = await searchParams;
  const { ctx } = await requireOrgPage(orgId);
  const db = getDb();
  const role = await orgRole(db, ctx, orgId);
  const canWrite = role === "owner" || role === "fleet_admin" || role === "manager";
  const vehicles = await listVehicles(db, ctx, { organizationId: orgId });
  const members = canWrite ? await listMembers(db, ctx, orgId) : [];
  const assignments = vehicles.length ? await db.select().from(schema.vehicleAssignments).where(and(inArray(schema.vehicleAssignments.vehicleId, vehicles.map((v) => v.id)), isNull(schema.vehicleAssignments.endsAt))) : [];
  const users = assignments.length ? await db.select({ id: schema.users.id, email: schema.users.email, name: schema.users.displayName }).from(schema.users).where(inArray(schema.users.id, assignments.map((a) => a.userId))) : [];
  const today = dayInZone(new Date());
  return (
    <div className="space-y-4">
      <OkFromQuery ok={q.ok} />
      <ErrorFromQuery error={q.erreur} />
      {canWrite && <LinkButton href={`/garage/nouveau?organizationId=${orgId}`}>Ajouter un véhicule à la flotte</LinkButton>}
      {vehicles.length === 0 ? (
        <EmptyState title="Aucun véhicule">{role === "driver" ? "Aucun véhicule ne vous est affecté." : "Ajoutez les véhicules de la flotte."}</EmptyState>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {vehicles.map((v) => {
            const a = assignments.find((x) => x.vehicleId === v.id);
            const u = a && users.find((x) => x.id === a.userId);
            return (
              <Card key={v.id} title={<Link className="underline" href={`/garage/${v.id}`}>{v.name}</Link>} action={v.plate ? <Badge>{v.plate}</Badge> : null}>
                <p className="text-sm">{a ? <>Affecté à <strong>{u?.name ?? u?.email}</strong> depuis le {formatDate(a.startsAt)}{a.startOdometerKm ? ` (${formatKm(a.startOdometerKm)})` : ""}</> : "Non affecté"}</p>
                {canWrite && (a ? (
                  <form action={endAssignmentAction} className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                    <input type="hidden" name="organizationId" value={orgId} /><input type="hidden" name="assignmentId" value={a.id} />
                    <Field label="Fin" htmlFor={`e-${v.id}`}><Input id={`e-${v.id}`} name="endsAt" type="date" defaultValue={today} /></Field>
                    <Field label="Compteur de fin" htmlFor={`eo-${v.id}`}><Input id={`eo-${v.id}`} name="endOdometerKm" inputMode="numeric" /></Field>
                    <div className="flex items-end"><Button type="submit" variant="secondary">Terminer</Button></div>
                  </form>
                ) : (
                  <form action={assignVehicleAction} className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <input type="hidden" name="organizationId" value={orgId} /><input type="hidden" name="vehicleId" value={v.id} />
                    <Field label="Conducteur" htmlFor={`u-${v.id}`}><Select id={`u-${v.id}`} name="userId">{members.map((m) => <option key={m.membership.userId} value={m.membership.userId}>{m.displayName ?? m.email}</option>)}</Select></Field>
                    <Field label="Début" htmlFor={`s-${v.id}`}><Input id={`s-${v.id}`} name="startsAt" type="date" defaultValue={today} /></Field>
                    <Field label="Compteur de début" htmlFor={`so-${v.id}`}><Input id={`so-${v.id}`} name="startOdometerKm" inputMode="numeric" /></Field>
                    <div className="flex items-end"><Button type="submit">Affecter</Button></div>
                  </form>
                ))}
              </Card>
            );
          })}
        </div>
      )}
      <p className="text-xs text-muted">Les compteurs de début et de fin d&apos;affectation permettent un ratio de consommation par conducteur ; sans eux, seules les dépenses sont attribuées.</p>
    </div>
  );
}
