import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, makeUser, expectCode } from "./helpers";
import { schema } from "@/db/client";
import { nearbyStations, reportStation, stationDetail } from "@/server/services/stations";
import { parseFeedRecord, upsertParsedStations, importFuelPrices, importAllFuelPrices } from "@/integrations/fuel-prices";
import { requestMagicLink, consumeMagicLink, resolveSession } from "@/server/auth";
import { createDemoAccount } from "@/server/services/demo";
import { homeData } from "@/server/services/dashboard";
import { listFillups } from "@/server/services/fillups";
import { deleteAccount, exportAccount } from "@/server/services/exports";
import { createVehicle } from "@/server/services/vehicles";
import { draftQuoteRequest, sendQuoteRequest, incomingRequests, withdrawQuoteConsent, MAX_QUOTE_RECIPIENTS } from "@/server/services/partners";
import { createOrganization } from "@/server/services/organizations";
import feed from "../fixtures/prix-carburants-sample.json";

describe("Import prix-carburants (fixture du flux officiel)", () => {
  it("analyse les enregistrements, conserve dates et ruptures, n'invente rien", async () => {
    const parsed = feed.results.map(parseFeedRecord);
    expect(parsed[0]!.prices.find((p) => p.fuel === "E85")!.price).toBe("0.899");
    expect(parsed[0]!.lat).toBeCloseTo(48.8599, 3);
    expect(parsed[1]!.unavailable).toContain("E85");
    expect(parsed[1]!.prices.find((p) => p.fuel === "E85")).toBeUndefined();
    expect(parseFeedRecord({ id: 9 })).toBeNull();
    const r1 = await upsertParsedStations(db(), parsed.filter(Boolean) as never);
    const r2 = await upsertParsedStations(db(), parsed.filter(Boolean) as never);
    expect(r1.observations).toBeGreaterThan(0);
    expect(r2.observations).toBe(0); // réimport idempotent
  });

  it("source indisponible : erreur journalisée, derniers prix datés conservés", async () => {
    const failing = (async () => new Response("down", { status: 503 })) as unknown as typeof fetch;
    const res = await importFuelPrices(db(), { lat: 48.86, lng: 2.35, radiusKm: 5, fetchImpl: failing, maxRecords: 100 });
    expect(res.ok).toBe(false);
    const [h] = await db().select().from(schema.integrationHealth).where(eq(schema.integrationHealth.key, "prix-carburants"));
    expect(h.status).toBe("erreur");
    const obs = await db().select().from(schema.priceObservations);
    expect(obs.length).toBeGreaterThan(0);
  });

  it("import de toute la France via l'export JSON : une seule requête, par lots, idempotent", async () => {
    const urls: string[] = [];
    // 1 200 stations : plusieurs lots de 500 et des identifiants en double dans le flux.
    const many = Array.from({ length: 1200 }, (_, i) => ({ ...feed.results[i % feed.results.length], id: 900000 + (i % 1100) }));
    const exp = (async (u: URL | string) => {
      urls.push(String(u));
      return new Response(JSON.stringify(many), { status: 200 });
    }) as unknown as typeof fetch;
    const r1 = await importAllFuelPrices(db(), { fetchImpl: exp });
    expect(r1.ok).toBe(true);
    expect(urls).toHaveLength(1);
    expect(urls[0]).toMatch(/\/exports\/json$/);
    if (r1.ok) expect(r1.stations).toBe(1100);
    const r2 = await importAllFuelPrices(db(), { fetchImpl: exp });
    if (r2.ok) expect(r2.observations).toBe(0);
    const [h] = await db().select().from(schema.integrationHealth).where(eq(schema.integrationHealth.key, "prix-carburants"));
    expect(h.status).toBe("ok");
  });

  it("import paginé via l'API (fetch simulé)", async () => {
    const ok = (async () => new Response(JSON.stringify(feed), { status: 200 })) as unknown as typeof fetch;
    const res = await importFuelPrices(db(), { lat: 48.86, lng: 2.35, radiusKm: 5, fetchImpl: ok, maxRecords: 100 });
    expect(res.ok).toBe(true);
  });
});

describe("L — prix périmé et rupture signalée", () => {
  it("la fiche conserve provenance et date et avertit de l'incertitude", async () => {
    const u = await makeUser("station");
    const [s] = await db().insert(schema.stations).values({ source: "test", sourceId: `L-${Date.now()}`, name: "Station L", lat: 45.5, lng: 4.5 }).returning();
    await db().insert(schema.stationFuels).values({ stationId: s.id, fuel: "E85", availability: "propose" });
    await db().insert(schema.priceObservations).values({ stationId: s.id, fuel: "E85", price: "0.8900", source: "test-officiel", observedAt: new Date(Date.now() - 5 * 86_400_000) });
    await reportStation(db(), u, { stationId: s.id, fuel: "E85", kind: "rupture" });
    await reportStation(db(), u, { stationId: s.id, fuel: "E85", kind: "prix", reportedPrice: "0,79" });
    const d = await stationDetail(db(), u, s.id, null);
    const e85 = d.fuels.find((f) => f.fuel === "E85")!;
    expect(e85.price!.toString()).toBe("0.89");
    expect(e85.source).toBe("test-officiel");
    expect(e85.stale).toBe(true);
    expect(e85.availability).toBe("rupture_signalee");
    expect(e85.warnings.join(" ")).toContain("Prix ancien");
    expect(e85.warnings.join(" ")).toContain("Rupture signalée");
    // le prix communautaire n'écrase pas le prix officiel
    expect(e85.communityPrice!.price.toString()).toBe("0.79");
    const near = await nearbyStations(db(), u, { lat: 45.5, lng: 4.5, radiusKm: 5, fuel: "E85", excludeRupture: true });
    expect(near.find((n) => n.station.id === s.id)).toBeUndefined();
  });
});

describe("Authentification par lien", () => {
  it("lien à usage unique, session valide", async () => {
    const email = `magic-${Date.now()}@test.invalid`;
    const { devLink } = await requestMagicLink(db(), email);
    const token = new URL(devLink!).searchParams.get("token")!;
    const { sessionToken, isNew } = await consumeMagicLink(db(), token);
    expect(isNew).toBe(true);
    const s = await resolveSession(db(), sessionToken);
    expect(s?.user.email).toBe(email);
    await expectCode(consumeMagicLink(db(), token), "SESSION_EXPIRED");
    expect(await resolveSession(db(), "faux-jeton")).toBeNull();
    await expectCode(requestMagicLink(db(), "pas-un-email"), "VALIDATION");
  });
});

describe("Mode démonstration isolé", () => {
  it("crée des données fictives marquées, jamais visibles d'un compte réel", async () => {
    const demo = await createDemoAccount(db());
    const h = await homeData(db(), demo);
    expect(h.summary!.vehicle.name).toContain("démo");
    expect(h.summary!.amortization).not.toBeNull();
    const list = await listFillups(db(), demo, {});
    expect(list.rows.every((r) => r.source === "demo")).toBe(true);
    const real = await makeUser("reel");
    const mine = await listFillups(db(), real, {});
    expect(mine.total).toBe(0);
    const near = await nearbyStations(db(), real, { lat: 48.8566, lng: 2.3522, radiusKm: 20 });
    expect(near.every((n) => !n.station.isDemo)).toBe(true);
  });
});

describe("Export et suppression de compte", () => {
  it("exporte puis supprime les données personnelles", async () => {
    const u = await makeUser("rgpd");
    await createVehicle(db(), u, { name: "V", energy: "essence" });
    const data = await exportAccount(db(), u);
    expect(data.vehicles).toHaveLength(1);
    await deleteAccount(db(), u);
    const [left] = await db().select().from(schema.users).where(eq(schema.users.id, u.userId));
    expect(left).toBeUndefined();
  });
});

describe("Devis partenaires consentis", () => {
  it("consentement nominatif, plafond de destinataires, retrait", async () => {
    const owner = await makeUser("garage");
    const org = await createOrganization(db(), owner, { name: "Garage test", kind: "partenaire" });
    const [p] = await db().insert(schema.partners).values({ name: "Garage test", organizationId: org.id, verifiedAt: new Date(), services: ["conversion_e85"], zones: ["75"] }).returning();
    const extra = await db().insert(schema.partners).values(Array.from({ length: MAX_QUOTE_RECIPIENTS }, (_, i) => ({ name: `G${i}`, verifiedAt: new Date() }))).returning();
    const client = await makeUser("client");
    await expectCode(draftQuoteRequest(db(), client, { need: "Conversion", zone: "75", contactChannel: "email", contactValue: client.email, partnerIds: [p.id, ...extra.map((e) => e.id)] }), "VALIDATION");
    const { request } = await draftQuoteRequest(db(), client, { need: "Conversion E85", zone: "75011", contactChannel: "email", contactValue: client.email, partnerIds: [p.id] });
    await expectCode(sendQuoteRequest(db(), client, request.id, [], [p.id]), "VALIDATION");
    await sendQuoteRequest(db(), client, request.id, [p.id], [p.id]);
    let inbox = await incomingRequests(db(), owner, org.id);
    expect(inbox.requests[0].contact?.value).toBe(client.email);
    await withdrawQuoteConsent(db(), client, inbox.requests[0].recipientId);
    inbox = await incomingRequests(db(), owner, org.id);
    expect(inbox.requests[0].contact).toBeNull();
    const stranger = await makeUser("autre-garage");
    await expectCode(incomingRequests(db(), stranger, org.id), "NOT_FOUND");
  });
});
