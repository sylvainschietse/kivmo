import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, makeUser, daysAgo, expectCode } from "./helpers";
import { schema } from "@/db/client";
import { createOrganization, decideFillup, fleetDashboard, inviteMember, acceptInvitation, revokeInvitation } from "@/server/services/organizations";
import { createVehicle, assignVehicle } from "@/server/services/vehicles";
import { createFillup, getFillup, updateFillup, listFillups } from "@/server/services/fillups";
import { storeAttachment, readAttachment, attachmentUrl } from "@/server/services/attachments";
import { closePeriod, reopenPeriod } from "@/server/services/periods";
import { exportCsv } from "@/server/services/exports";
import type { Ctx } from "@/server/authz";

const png = () => Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Array.from({ length: 8 }, () => Math.floor(Math.random() * 255))]);

async function orgWithDriver(name: string) {
  const owner = await makeUser(`owner-${name}`);
  const driver = await makeUser(`driver-${name}`);
  const org = await createOrganization(db(), owner, { name });
  await db().insert(schema.memberships).values({ organizationId: org.id, userId: driver.userId, role: "driver" });
  const v = await createVehicle(db(), owner, { name: `Van ${name}`, energy: "diesel", organizationId: org.id });
  await assignVehicle(db(), owner, v.id, { userId: driver.userId, startsAt: daysAgo(100) });
  return { owner, driver, org, v };
}

describe("I — isolation entre entreprises", () => {
  it("un employé de A ne lit ni plein ni ticket de B, même avec l'identifiant", async () => {
    const A = await orgWithDriver("A");
    const B = await orgWithDriver("B");
    const { attachment } = await storeAttachment(db(), B.driver, { kind: "ticket", mimeType: "image/png", data: png(), organizationId: B.org.id });
    const r = await createFillup(db(), B.driver, { vehicleId: B.v.id, occurredAt: daysAgo(3), odometerKm: "1000", isFull: true, lines: [{ fuel: "GAZOLE", liters: "40", amount: "68" }], receiptAttachmentId: attachment.id }, "b1");
    if (!("fillup" in r)) throw new Error();
    await expectCode(getFillup(db(), A.driver, r.fillup.id), "NOT_FOUND");
    await expectCode(getFillup(db(), A.owner, r.fillup.id), "NOT_FOUND");
    await expectCode(readAttachment(db(), A.owner, attachment.id), "NOT_FOUND");
    await expectCode(attachmentUrl(db(), A.driver, attachment.id), "NOT_FOUND");
    // Le propriétaire de B y accède via le plein
    const ok = await readAttachment(db(), B.owner, attachment.id);
    expect(ok.data.length).toBeGreaterThan(0);
    await expectCode(listFillups(db(), A.owner, { organizationId: B.org.id }), "NOT_FOUND");
    await expectCode(fleetDashboard(db(), A.owner, B.org.id, daysAgo(30), new Date()), "NOT_FOUND");
  });

  it("un conducteur ne voit que ses pleins ; le comptable ne peut pas modifier", async () => {
    const A = await orgWithDriver("C");
    const d2 = await makeUser("driver2");
    await db().insert(schema.memberships).values({ organizationId: A.org.id, userId: d2.userId, role: "driver" });
    await assignVehicle(db(), A.owner, A.v.id, { userId: d2.userId, startsAt: daysAgo(50) });
    const acc = await makeUser("compta");
    await db().insert(schema.memberships).values({ organizationId: A.org.id, userId: acc.userId, role: "accountant" });
    const r1 = await createFillup(db(), A.driver, { vehicleId: A.v.id, occurredAt: daysAgo(10), odometerKm: "1000", isFull: true, lines: [{ fuel: "GAZOLE", liters: "40", amount: "68" }] }, "x1");
    await createFillup(db(), d2, { vehicleId: A.v.id, occurredAt: daysAgo(5), odometerKm: "1500", isFull: true, lines: [{ fuel: "GAZOLE", liters: "35", amount: "60" }] }, "x2");
    const mine = await listFillups(db(), d2, { organizationId: A.org.id });
    expect(mine.total).toBe(1);
    const all = await listFillups(db(), acc, { organizationId: A.org.id });
    expect(all.total).toBe(2);
    if (!("fillup" in r1)) throw new Error();
    await expectCode(getFillup(db(), d2, r1.fillup.id), "NOT_FOUND");
    await expectCode(updateFillup(db(), acc, r1.fillup.id, { stationLabel: "x" }, r1.fillup.version), "FORBIDDEN");
    const csv = await exportCsv(db(), d2, { organizationId: A.org.id });
    expect(csv.split("\r\n")).toHaveLength(2); // en-tête + son seul plein
    const outsider = await makeUser("dehors");
    await expectCode(exportCsv(db(), outsider, { organizationId: A.org.id }), "NOT_FOUND");
  });

  it("pleins conducteurs : soumis puis validés ou rejetés avec raison", async () => {
    const A = await orgWithDriver("D");
    const r = await createFillup(db(), A.driver, { vehicleId: A.v.id, occurredAt: daysAgo(2), odometerKm: "1000", isFull: true, lines: [{ fuel: "GAZOLE", liters: "40", amount: "68" }] }, "s1");
    if (!("fillup" in r)) throw new Error();
    expect(r.fillup.approvalStatus).toBe("submitted");
    await expectCode(decideFillup(db(), A.driver, r.fillup.id, "validated"), "FORBIDDEN");
    await expectCode(decideFillup(db(), A.owner, r.fillup.id, "rejected"), "VALIDATION");
    await decideFillup(db(), A.owner, r.fillup.id, "rejected", "Ticket illisible");
    const { fillup } = await getFillup(db(), A.owner, r.fillup.id);
    expect(fillup.approvalStatus).toBe("rejected");
    expect(fillup.approvalReason).toBe("Ticket illisible");
  });

  it("invitations : expiration, révocation, adresse vérifiée", async () => {
    const A = await orgWithDriver("E");
    const invitee = await makeUser("invite");
    const inv = await inviteMember(db(), A.owner, A.org.id, { email: invitee.email, role: "manager" });
    const token = new URL(inv.link!).searchParams.get("token")!;
    const other = await makeUser("autre");
    await expectCode(acceptInvitation(db(), other, token), "FORBIDDEN");
    await revokeInvitation(db(), A.owner, inv.invitation.id);
    await expectCode(acceptInvitation(db(), invitee, token), "SESSION_EXPIRED");
    const inv2 = await inviteMember(db(), A.owner, A.org.id, { email: invitee.email, role: "manager" });
    const orgId = await acceptInvitation(db(), invitee, new URL(inv2.link!).searchParams.get("token")!);
    expect(orgId).toBe(A.org.id);
    await expectCode(inviteMember(db(), A.driver, A.org.id, { email: "x@test.invalid", role: "driver" }), "FORBIDDEN");
  });
});

describe("J — période clôturée", () => {
  it("modification ordinaire refusée, correction administrateur motivée et tracée", async () => {
    const A = await orgWithDriver("J");
    const at = new Date(Date.UTC(2026, 8, 15, 10));
    const r = await createFillup(db(), A.owner, { vehicleId: A.v.id, occurredAt: at, odometerKm: "1000", isFull: true, lines: [{ fuel: "GAZOLE", liters: "40", amount: "68" }] }, "j1");
    if (!("fillup" in r)) throw new Error();
    await closePeriod(db(), A.owner, A.org.id, "2026-09");
    await expectCode(updateFillup(db(), A.owner, r.fillup.id, { stationLabel: "Station X" }, r.fillup.version), "PERIOD_CLOSED");
    await expectCode(createFillup(db(), A.driver, { vehicleId: A.v.id, occurredAt: new Date(Date.UTC(2026, 8, 20)), odometerKm: "1500", isFull: true, lines: [{ fuel: "GAZOLE", liters: "30", amount: "50" }] }, "j2"), "PERIOD_CLOSED");
    await expectCode(updateFillup(db(), A.driver, r.fillup.id, { stationLabel: "x", correctionReason: "y" }, r.fillup.version, { closedPeriodCorrection: true }), "NOT_FOUND");
    await expectCode(updateFillup(db(), A.owner, r.fillup.id, { stationLabel: "x" }, r.fillup.version, { closedPeriodCorrection: true }), "VALIDATION");
    const ok = await updateFillup(db(), A.owner, r.fillup.id, { lines: [{ fuel: "GAZOLE", liters: "40", amount: "66" }], correctionReason: "Remise oubliée sur le ticket" }, r.fillup.version, { closedPeriodCorrection: true });
    expect(ok.status).toBe("updated");
    const audits = await db().select().from(schema.auditEvents).where(eq(schema.auditEvents.resourceId, r.fillup.id));
    const corr = audits.find((a) => a.action === "fillup.correction_closed_period");
    expect(corr).toBeTruthy();
    expect((corr!.details as { reason: string }).reason).toBe("Remise oubliée sur le ticket");
    await expectCode(reopenPeriod(db(), A.owner, A.org.id, "2026-09", ""), "VALIDATION");
    await reopenPeriod(db(), A.owner, A.org.id, "2026-09", "Facture fournisseur reçue en retard");
    const { fillup } = await getFillup(db(), A.owner, r.fillup.id);
    const r2 = await updateFillup(db(), A.owner, r.fillup.id, { stationLabel: "Station Y" }, fillup.version);
    expect(r2.status).toBe("updated");
  });
});

describe("K — deux conducteurs sans relevés d'affectation", () => {
  it("affiche les coûts par conducteur, pas de ratio individuel inventé", async () => {
    const A = await orgWithDriver("K");
    const d2 = await makeUser("k2");
    await db().insert(schema.memberships).values({ organizationId: A.org.id, userId: d2.userId, role: "driver" });
    await assignVehicle(db(), A.owner, A.v.id, { userId: d2.userId, startsAt: daysAgo(100) });
    await createFillup(db(), A.driver, { vehicleId: A.v.id, occurredAt: daysAgo(20), odometerKm: "1000", isFull: true, lines: [{ fuel: "GAZOLE", liters: "40", amount: "68" }] }, "k1");
    await createFillup(db(), d2, { vehicleId: A.v.id, occurredAt: daysAgo(10), odometerKm: "1700", isFull: true, lines: [{ fuel: "GAZOLE", liters: "42", amount: "71" }] }, "k2");
    const dash = await fleetDashboard(db(), A.owner, A.org.id, daysAgo(60), new Date());
    expect(dash.byDriver).toHaveLength(2);
    for (const d of dash.byDriver) {
      expect(d.consumptionMeasured).toBe(false);
      expect(d.consumptionL100).toBeNull();
      expect(d.note).toContain("Dépenses attribuées uniquement");
    }
    expect(dash.byVehicle[0].consumptionL100!.toString()).toBe("6");
    expect(dash.totalSpend.toString()).toBe("139");
  });
});

export type { Ctx };
