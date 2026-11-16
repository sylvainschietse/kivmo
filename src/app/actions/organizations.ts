"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db/client";
import { requireSession } from "@/server/session";
import { runAction, str, optStr } from "@/server/action";
import { acceptInvitation, createOrganization, createTeam, inviteMember, removeMember, revokeInvitation, upsertBudget } from "@/server/services/organizations";
import { closePeriod, reopenPeriod } from "@/server/services/periods";
import { assignVehicle, endAssignment } from "@/server/services/vehicles";
import { updateRequestStatus } from "@/server/services/partners";

const ok = (path: string, msg: string) => `${path}${path.includes("?") ? "&" : "?"}ok=${encodeURIComponent(msg)}`;

export async function createOrganizationAction(fd: FormData) {
  const { ctx } = await requireSession();
  await runAction("/entreprise", async () => {
    const org = await createOrganization(getDb(), ctx, { name: str(fd, "name"), kind: (str(fd, "kind") || "entreprise") as "entreprise" });
    revalidatePath("/", "layout");
    return ok(org.kind === "partenaire" ? `/espace-pro/${org.id}` : `/entreprise/${org.id}`, "Organisation créée.");
  });
}

export async function inviteMemberAction(fd: FormData) {
  const { ctx } = await requireSession();
  const orgId = str(fd, "organizationId");
  const back = `/entreprise/${orgId}/membres`;
  await runAction(back, async () => {
    const r = await inviteMember(getDb(), ctx, orgId, { email: str(fd, "email"), role: str(fd, "role") });
    const q = new URLSearchParams({ ok: r.link ? "Invitation créée. E-mail non envoyé dans cet environnement : transmettez le lien ci-dessous." : "Invitation envoyée par e-mail." });
    if (r.link) q.set("lien", r.link);
    return `${back}?${q}`;
  });
}

export async function revokeInvitationAction(fd: FormData) {
  const { ctx } = await requireSession();
  const orgId = str(fd, "organizationId");
  await runAction(`/entreprise/${orgId}/membres`, async () => {
    await revokeInvitation(getDb(), ctx, str(fd, "invitationId"));
    return ok(`/entreprise/${orgId}/membres`, "Invitation révoquée.");
  });
}

export async function removeMemberAction(fd: FormData) {
  const { ctx } = await requireSession();
  const orgId = str(fd, "organizationId");
  await runAction(`/entreprise/${orgId}/membres`, async () => {
    await removeMember(getDb(), ctx, orgId, str(fd, "userId"));
    return ok(`/entreprise/${orgId}/membres`, "Membre retiré ; ses accès sont coupés immédiatement.");
  });
}

export async function createTeamAction(fd: FormData) {
  const { ctx } = await requireSession();
  const orgId = str(fd, "organizationId");
  await runAction(`/entreprise/${orgId}/membres`, async () => {
    await createTeam(getDb(), ctx, orgId, str(fd, "name"), str(fd, "kind") || "equipe");
    return ok(`/entreprise/${orgId}/membres`, "Équipe créée.");
  });
}

export async function acceptInvitationAction(fd: FormData) {
  const { ctx } = await requireSession();
  const token = str(fd, "token");
  await runAction(`/invitation?token=${encodeURIComponent(token)}`, async () => {
    const m = await acceptInvitation(getDb(), ctx, token);
    revalidatePath("/", "layout");
    return ok(`/entreprise/${m}`, "Bienvenue dans l'organisation.");
  });
}

export async function upsertBudgetAction(fd: FormData) {
  const { ctx } = await requireSession();
  const orgId = str(fd, "organizationId");
  await runAction(`/entreprise/${orgId}`, async () => {
    await upsertBudget(getDb(), ctx, orgId, { scope: str(fd, "scope") as "flotte", scopeId: optStr(fd, "scopeId"), period: str(fd, "period") as "mensuel", amount: str(fd, "amount").replace(",", "."), alertThresholdPercent: Number(str(fd, "alert") || 80) });
    return ok(`/entreprise/${orgId}`, "Budget enregistré.");
  });
}

export async function closePeriodAction(fd: FormData) {
  const { ctx } = await requireSession();
  const orgId = str(fd, "organizationId");
  await runAction(`/entreprise/${orgId}/periodes`, async () => {
    await closePeriod(getDb(), ctx, orgId, str(fd, "month"));
    return ok(`/entreprise/${orgId}/periodes`, "Période clôturée.");
  });
}

export async function reopenPeriodAction(fd: FormData) {
  const { ctx } = await requireSession();
  const orgId = str(fd, "organizationId");
  await runAction(`/entreprise/${orgId}/periodes`, async () => {
    await reopenPeriod(getDb(), ctx, orgId, str(fd, "month"), str(fd, "reason"));
    return ok(`/entreprise/${orgId}/periodes`, "Période rouverte (motif journalisé).");
  });
}

export async function assignVehicleAction(fd: FormData) {
  const { ctx } = await requireSession();
  const orgId = str(fd, "organizationId");
  await runAction(`/entreprise/${orgId}/vehicules`, async () => {
    await assignVehicle(getDb(), ctx, str(fd, "vehicleId"), { userId: str(fd, "userId"), startsAt: new Date(str(fd, "startsAt") || Date.now()), startOdometerKm: optStr(fd, "startOdometerKm") });
    return ok(`/entreprise/${orgId}/vehicules`, "Affectation enregistrée.");
  });
}

export async function endAssignmentAction(fd: FormData) {
  const { ctx } = await requireSession();
  const orgId = str(fd, "organizationId");
  await runAction(`/entreprise/${orgId}/vehicules`, async () => {
    await endAssignment(getDb(), ctx, str(fd, "assignmentId"), { endsAt: new Date(str(fd, "endsAt") || Date.now()), endOdometerKm: optStr(fd, "endOdometerKm") });
    return ok(`/entreprise/${orgId}/vehicules`, "Affectation terminée.");
  });
}

export async function updateRequestStatusAction(fd: FormData) {
  const { ctx } = await requireSession();
  const orgId = str(fd, "organizationId");
  await runAction(`/espace-pro/${orgId}`, async () => {
    await updateRequestStatus(getDb(), ctx, orgId, str(fd, "recipientId"), str(fd, "status") as "contacte");
    return ok(`/espace-pro/${orgId}`, "Statut mis à jour.");
  });
}
