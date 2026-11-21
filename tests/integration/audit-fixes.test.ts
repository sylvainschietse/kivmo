import { describe, expect, it } from "vitest";
import { db, makeUser, daysAgo, expectCode } from "./helpers";
import { consumeMagicLink, loginWithPassword, requestMagicLink, resolveSession, signUpWithPassword } from "@/server/auth";
import { createVehicle, addReferenceProfile } from "@/server/services/vehicles";
import { createFillup } from "@/server/services/fillups";
import { allocateAvailableGains, createProject } from "@/server/services/savings";
import { acceptInvitation, createOrganization, inviteMember, removeMember } from "@/server/services/organizations";

describe("Compte créé avec l'adresse de quelqu'un d'autre", () => {
  it("le lien email efface le mot de passe posé avant et ferme ses sessions", async () => {
    const email = `victime-${Date.now()}@test.invalid`;
    const attacker = await signUpWithPassword(db(), email, "mot-de-passe-de-l-intrus");
    const { devLink } = await requestMagicLink(db(), email);
    const { user, sessionToken } = await consumeMagicLink(db(), new URL(devLink!).searchParams.get("token")!);
    expect(user.id).toBe(attacker.user.id);
    expect(user.passwordHash).toBeNull();
    expect(await resolveSession(db(), attacker.sessionToken)).toBeNull();
    expect(await resolveSession(db(), sessionToken)).not.toBeNull();
    await expectCode(loginWithPassword(db(), email, "mot-de-passe-de-l-intrus"), "VALIDATION");
  });
});

describe("Répartition de l'épargne inférieure à 100 %", () => {
  it("un projet à 50 % reçoit 25 € sur 50 €, et rien de plus au deuxième clic", async () => {
    const u = await makeUser("moitie");
    const v = await createVehicle(db(), u, { name: "V", energy: "e85_conversion" });
    await addReferenceProfile(db(), u, v.id, { kind: "scenario_libre", label: "Réf", fuel: "GAZOLE", consumptionL100: "6", priceMode: "fixed", fixedPrice: "2.5", effectiveFrom: daysAgo(90) });
    await createFillup(db(), u, { vehicleId: v.id, occurredAt: daysAgo(40), odometerKm: "10000", isFull: true, lines: [{ fuel: "E85", liters: "40", amount: "36" }] }, "a");
    await createFillup(db(), u, { vehicleId: v.id, occurredAt: daysAgo(30), odometerKm: "10600", isFull: true, lines: [{ fuel: "E85", liters: "45", amount: "40" }] }, "b");
    const p = await createProject(db(), u, { name: "Moitié", sharePercent: "50" });
    const first = await allocateAvailableGains(db(), u);
    expect(first.lines.find((l) => l.projectId === p.id)?.amount.toString()).toBe("25");
    const second = await allocateAvailableGains(db(), u);
    expect(second.lines).toHaveLength(0);
  });
});

describe("Droits dans une organisation", () => {
  it("un administrateur de flotte ne peut pas retirer le propriétaire", async () => {
    const owner = await makeUser("proprio");
    const admin = await makeUser("admin-flotte");
    const org = await createOrganization(db(), owner, { name: "Flotte" });
    const inv = await inviteMember(db(), owner, org.id, { email: admin.email, role: "fleet_admin" });
    await acceptInvitation(db(), admin, new URL(inv.link!).searchParams.get("token")!);
    await expectCode(removeMember(db(), admin, org.id, owner.userId), "FORBIDDEN");
  });
});
