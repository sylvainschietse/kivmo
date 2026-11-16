import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, makeUser, daysAgo, expectCode } from "./helpers";
import { schema } from "@/db/client";
import { createVehicle, addReferenceProfile, setConversion, declareOdometerReplacement } from "@/server/services/vehicles";
import { createFillup, updateFillup, deleteFillup, listFillups } from "@/server/services/fillups";
import { vehicleSummary, homeData } from "@/server/services/dashboard";
import { storeAttachment } from "@/server/services/attachments";

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, Math.floor(Math.random() * 255)]);

async function setup() {
  const u = await makeUser("conducteur");
  const v = await createVehicle(db(), u, { name: "Captur", energy: "e85_conversion", tankCapacityL: "48" });
  await addReferenceProfile(db(), u, v.id, { kind: "ancien_vehicule", label: "Qashqai diesel", fuel: "GAZOLE", consumptionL100: "6", priceMode: "fixed", fixedPrice: "1,70", effectiveFrom: daysAgo(60) });
  return { u, v };
}

const fill = (vehicleId: string, d: number, odo: string, full: boolean, liters: string, amount: string, extra: Record<string, unknown> = {}) => ({
  vehicleId,
  occurredAt: daysAgo(d),
  odometerKm: odo,
  isFull: full,
  lines: [{ fuel: "E85" as const, liters, amount }],
  ...extra,
});

describe("Parcours plein → calcul (cas A, B, M)", () => {
  it("M : première ouverture, aucun total inventé", async () => {
    const u = await makeUser("nouveau");
    const h = await homeData(db(), u);
    expect(h.summary).toBeNull();
    expect(h.savings.gains.calculatedGains.toString()).toBe("0");
    expect(h.vehicles).toHaveLength(0);
  });

  it("A + B : deux pleins complets avec partiel, calcul conforme et persisté", async () => {
    const { u, v } = await setup();
    await setConversion(db(), u, v.id, { declaredType: "Boîtier", date: daysAgo(31).toISOString().slice(0, 10), odometerKm: "10000", cost: "360" });
    const a = await createFillup(db(), u, fill(v.id, 30, "10000", true, "40", "36"), "k-a");
    expect(a.status).toBe("created");
    let s = await vehicleSummary(db(), u, v.id);
    expect(s.headline).toContain("Premier plein : point de départ enregistré");
    await createFillup(db(), u, fill(v.id, 20, "10250", false, "20", "18"), "k-p");
    await createFillup(db(), u, fill(v.id, 10, "10 600", true, "25", "22,50"), "k-b");
    s = await vehicleSummary(db(), u, v.id);
    expect(s.lastInterval!.distanceKm.toString()).toBe("600");
    expect(s.lastInterval!.consumptionL100!.toString()).toBe("7.5");
    expect(s.lastComparison!.gain!.toString()).toBe("20.7");
    expect(s.amortization!.netAfterConversion.toString()).toBe("-339.3");
    expect(s.amortization!.remainingToAmortize.toString()).toBe("339.3");
    const rows = await db().select().from(schema.consumptionIntervals).where(eq(schema.consumptionIntervals.vehicleId, v.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].calcVersion).toBeTruthy();
  });
});

describe("Doublons, idempotence et concurrence", () => {
  it("une même clé d'idempotence ne crée qu'un plein, même en parallèle", async () => {
    const { u, v } = await setup();
    const input = fill(v.id, 5, "20000", true, "40", "36");
    const results = await Promise.all([createFillup(db(), u, input, "same-key"), createFillup(db(), u, input, "same-key"), createFillup(db(), u, input, "same-key")]);
    const ids = new Set(results.map((r) => ("fillup" in r ? r.fillup.id : null)));
    expect(ids.size).toBe(1);
    const list = await listFillups(db(), u, { vehicleId: v.id });
    expect(list.total).toBe(1);
  });

  it("un ticket ne peut pas créer deux pleins", async () => {
    const { u, v } = await setup();
    const { attachment } = await storeAttachment(db(), u, { kind: "ticket", mimeType: "image/png", data: png });
    await createFillup(db(), u, fill(v.id, 5, "20000", true, "40", "36", { receiptAttachmentId: attachment.id }), "t1");
    const again = await storeAttachment(db(), u, { kind: "ticket", mimeType: "image/png", data: png });
    expect(again.duplicate).toBe(true);
    await expectCode(createFillup(db(), u, fill(v.id, 1, "20500", true, "40", "36", { receiptAttachmentId: attachment.id }), "t2"), "DUPLICATE");
  });

  it("doublon probable : confirmation demandée, puis accepté si confirmé", async () => {
    const { u, v } = await setup();
    await createFillup(db(), u, fill(v.id, 5, "20000", true, "40", "36"), "d1");
    const r = await createFillup(db(), u, { ...fill(v.id, 5, "20000", true, "40", "36"), occurredAt: new Date(daysAgo(5).getTime() + 60_000) }, "d2");
    expect(r.status).toBe("needs_confirmation");
    const r2 = await createFillup(db(), u, { ...fill(v.id, 5, "20001", true, "40", "36"), occurredAt: new Date(daysAgo(5).getTime() + 60_000), confirmDuplicate: true, confirmIssues: true }, "d3");
    expect(r2.status).toBe("created");
  });

  it("trois valeurs divergentes : demande de correction", async () => {
    const { u, v } = await setup();
    const r = await createFillup(db(), u, { ...fill(v.id, 5, "20000", true, "40", "50"), lines: [{ fuel: "E85", liters: "40", unitPrice: "0,90", amount: "50" }] }, "m1");
    expect(r.status).toBe("amount_mismatch");
  });

  it("compteur non croissant : confirmation explicitée, jamais blocage sans recours", async () => {
    const { u, v } = await setup();
    await createFillup(db(), u, fill(v.id, 10, "20000", true, "40", "36"), "c1");
    const r = await createFillup(db(), u, fill(v.id, 5, "19000", true, "40", "36"), "c2");
    expect(r.status).toBe("needs_confirmation");
    const ok = await createFillup(db(), u, { ...fill(v.id, 5, "19000", true, "40", "36"), confirmIssues: true, confirmNote: "Erreur de lecture corrigée plus tard" }, "c3");
    expect(ok.status).toBe("created");
  });

  it("date future refusée", async () => {
    const { u, v } = await setup();
    await expectCode(createFillup(db(), u, fill(v.id, -3, "20000", true, "40", "36"), "f1"), "VALIDATION");
  });

  it("verrou optimiste : une correction concurrente n'écrase pas l'autre", async () => {
    const { u, v } = await setup();
    const r = await createFillup(db(), u, fill(v.id, 5, "20000", true, "40", "36"), "v1");
    if (!("fillup" in r)) throw new Error();
    await updateFillup(db(), u, r.fillup.id, { stationLabel: "A" }, r.fillup.version);
    await expectCode(updateFillup(db(), u, r.fillup.id, { stationLabel: "B" }, r.fillup.version), "VERSION_CONFLICT");
  });
});

describe("G — correction d'un ancien plein", () => {
  it("recalcule les intervalles voisins sans toucher aux virements", async () => {
    const { u, v } = await setup();
    const a = await createFillup(db(), u, fill(v.id, 30, "10000", true, "40", "36"), "g1");
    const b = await createFillup(db(), u, fill(v.id, 20, "10600", true, "45", "40.50"), "g2");
    await createFillup(db(), u, fill(v.id, 10, "11200", true, "45", "40.50"), "g3");
    const [proj] = await db().insert(schema.projects).values({ ownerUserId: u.userId, name: "P" }).returning();
    await db().insert(schema.savingsEntries).values({ ownerUserId: u.userId, projectId: proj.id, kind: "bank_confirmed", amount: "20.7000", occurredOn: "2026-10-01", provenance: "test" });
    if (!("fillup" in b) || !("fillup" in a)) throw new Error();
    await updateFillup(db(), u, b.fillup.id, { odometerKm: "10500" }, b.fillup.version);
    const s = await vehicleSummary(db(), u, v.id);
    expect(s.intervals.map((i) => i.distanceKm.toString())).toEqual(["500", "700"]);
    const entries = await db().select().from(schema.savingsEntries).where(eq(schema.savingsEntries.projectId, proj.id));
    expect(entries).toHaveLength(1);
    expect(entries[0].amount).toBe("20.7000");
    await deleteFillup(db(), u, b.fillup.id, "Saisie en double");
    const s2 = await vehicleSummary(db(), u, v.id);
    expect(s2.intervals).toHaveLength(1);
    expect(s2.intervals[0].distanceKm.toString()).toBe("1200");
    const audit = await db().select().from(schema.auditEvents).where(eq(schema.auditEvents.resourceId, b.fillup.id));
    expect(audit.map((x) => x.action)).toEqual(expect.arrayContaining(["fillup.update", "fillup.delete"]));
  });

  it("compteur remplacé : décalage historisé appliqué", async () => {
    const { u, v } = await setup();
    await createFillup(db(), u, fill(v.id, 30, "99800", true, "40", "36"), "o1");
    await declareOdometerReplacement(db(), u, v.id, { occurredAt: daysAgo(25), oldReadingKm: "99900", newReadingKm: "0" });
    await createFillup(db(), u, { ...fill(v.id, 20, "500", true, "45", "40.50"), confirmIssues: true }, "o2");
    const s = await vehicleSummary(db(), u, v.id);
    expect(s.lastInterval!.distanceKm.toString()).toBe("600");
  });

  it("référence historisée : nouvelle version sans réécrire le passé", async () => {
    const { u, v } = await setup();
    await createFillup(db(), u, fill(v.id, 30, "10000", true, "40", "36"), "r1");
    await createFillup(db(), u, fill(v.id, 20, "10600", true, "45", "40.50"), "r2");
    await addReferenceProfile(db(), u, v.id, { kind: "ancien_vehicule", label: "v2", fuel: "GAZOLE", consumptionL100: "7", priceMode: "fixed", fixedPrice: "1.70", effectiveFrom: daysAgo(15) });
    await createFillup(db(), u, fill(v.id, 10, "11200", true, "45", "40.50"), "r3");
    const s = await vehicleSummary(db(), u, v.id);
    expect(s.comparisons[0].profileVersion).toBe(1);
    expect(s.comparisons[0].gain!.toString()).toBe("20.7");
    expect(s.comparisons[1].profileVersion).toBe(2);
  });
});

describe("Horodatage identique", () => {
  it("deux pleins saisis dans la même minute sont départagés par le compteur", async () => {
    const { u, v } = await setup();
    const at = daysAgo(3);
    const a = await createFillup(db(), u, { ...fill(v.id, 3, "20000", true, "40", "36"), occurredAt: at }, "same-a");
    expect(a.status).toBe("created");
    const b = await createFillup(db(), u, { ...fill(v.id, 3, "20500", true, "30", "27"), occurredAt: at }, "same-b");
    expect(b.status).toBe("created");
    const s = await vehicleSummary(db(), u, v.id);
    expect(s.intervals).toHaveLength(1);
    expect(s.intervals[0].consumptionL100?.toFixed(2)).toBe("6.00");
  });
});
