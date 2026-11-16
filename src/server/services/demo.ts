import { and, eq, lt } from "drizzle-orm";
import { schema, type DB } from "@/db/client";
import { randomToken } from "../auth";
import type { Ctx } from "../authz";
import { createFillup } from "./fillups";
import { addReferenceProfile, createVehicle, setConversion, assignVehicle } from "./vehicles";
import { allocateAvailableGains, createProject, declareManualTransfer } from "./savings";
import { createOrganization, upsertBudget } from "./organizations";
import { closePeriod } from "./periods";

/**
 * Mode démonstration : un compte isolé, marqué `is_demo`, avec des données FICTIVES.
 * Il n'est jamais fusionné avec un compte réel et n'accède qu'au bac à sable bancaire.
 */
const DEMO_SOURCE = "demo";

const daysAgo = (n: number, hour = 9) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  d.setUTCHours(hour, 0, 0, 0);
  return d;
};

async function demoUser(db: DB, label: string): Promise<Ctx> {
  const email = `demo-${label}-${randomToken(6).toLowerCase()}@demo.kivmo.invalid`;
  const [u] = await db.insert(schema.users).values({ email, displayName: label === "main" ? "Visiteur démo" : `Conducteur démo ${label}`, isDemo: true, onboardedAt: new Date() }).returning();
  await db.insert(schema.profiles).values({ userId: u.id, homeLat: 48.8566, homeLng: 2.3522, homeLabel: "Paris (démo)" });
  await db.insert(schema.notificationPreferences).values({ userId: u.id });
  return { userId: u.id, isDemo: true, isPlatformAdmin: false };
}

/** Données partagées en lecture : stations et professionnels fictifs, marqués démo. */
export async function ensureDemoCatalog(db: DB) {
  const [exists] = await db.select().from(schema.stations).where(eq(schema.stations.source, DEMO_SOURCE)).limit(1);
  if (!exists) {
    const fixtures = [
      { id: "demo-1", name: "Station Démo Bastille", brand: "Indépendant", address: "1 rue Fictive", city: "Paris", cp: "75011", lat: 48.8532, lng: 2.3692, e85: "0.899", gazole: "1.689", e10: "1.749", hours: 3, alwaysOpen: true, rupture: false },
      { id: "demo-2", name: "Station Démo Nation", brand: "Enseigne A", address: "2 avenue Imaginaire", city: "Paris", cp: "75012", lat: 48.8483, lng: 2.3959, e85: "0.949", gazole: "1.719", e10: "1.779", hours: 30, alwaysOpen: false, rupture: false },
      { id: "demo-3", name: "Station Démo Montreuil", brand: "Enseigne B", address: "3 bd de l'Exemple", city: "Montreuil", cp: "93100", lat: 48.8611, lng: 2.4437, e85: "0.879", gazole: "1.659", e10: "1.729", hours: 96, alwaysOpen: true, rupture: true },
      { id: "demo-4", name: "Station Démo Vincennes", brand: "Enseigne A", address: "4 place du Test", city: "Vincennes", cp: "94300", lat: 48.8474, lng: 2.4392, e85: null, gazole: "1.699", e10: "1.759", hours: 5, alwaysOpen: false, rupture: false },
    ];
    for (const f of fixtures) {
      const [s] = await db
        .insert(schema.stations)
        .values({ source: DEMO_SOURCE, sourceId: f.id, name: f.name, brand: f.brand, address: f.address, city: f.city, postalCode: f.cp, lat: f.lat, lng: f.lng, services: ["Gonflage", "Boutique"], payment: ["CB"], isAlwaysOpen: f.alwaysOpen, isDemo: true })
        .returning();
      const observedAt = new Date(Date.now() - f.hours * 3_600_000);
      for (const [fuel, price] of [["E85", f.e85], ["GAZOLE", f.gazole], ["SP95_E10", f.e10]] as const) {
        if (!price) continue;
        await db.insert(schema.stationFuels).values({ stationId: s.id, fuel, availability: fuel === "E85" && f.rupture ? "rupture_signalee" : "propose" });
        await db.insert(schema.priceObservations).values({ stationId: s.id, fuel, price, source: "démo (fictif)", observedAt, quality: "officielle" });
      }
    }
    const [p1] = await db.insert(schema.partners).values({ name: "Garage Démo Conversion", kind: "installateur", services: ["conversion_e85", "entretien"], zones: ["75", "93", "94"], city: "Paris", contactEmail: "contact@garage-demo.invalid", verifiedAt: new Date(), isDemo: true, brandColor: "#087F6B" }).returning();
    await db.insert(schema.partners).values({ name: "Atelier Démo Pneus", kind: "garage", services: ["pneus", "entretien"], zones: ["75", "92"], city: "Boulogne", contactEmail: "pneus@atelier-demo.invalid", verifiedAt: new Date(), isDemo: true });
    await db.insert(schema.sponsoredOffers).values({ partnerId: p1.id, title: "Bilan conversion offert (démo)", body: "Offre fictive affichée pour illustrer le format des offres sponsorisées.", startsAt: daysAgo(30), endsAt: daysAgo(-365), isDemo: true });
  }
}

export async function createDemoAccount(db: DB) {
  await ensureDemoCatalog(db);
  const ctx = await demoUser(db, "main");
  const vehicle = await createVehicle(db, ctx, { name: "Captur E85 (démo)", make: "Renault", model: "Captur", year: 2021, engine: "TCe 130", energy: "e85_conversion", tankCapacityL: "48", initialOdometerKm: "10000" });
  await setConversion(db, ctx, vehicle.id, { declaredType: "Boîtier E85 (déclaratif, démo)", date: daysAgo(120).toISOString().slice(0, 10), odometerKm: "10000", cost: "360", provider: "Garage Démo Conversion" });
  await addReferenceProfile(db, ctx, vehicle.id, { kind: "ancien_vehicule", label: "Ancien diesel (démo)", fuel: "GAZOLE", consumptionL100: "6", priceMode: "fixed", fixedPrice: "1.70", effectiveFrom: daysAgo(130), method: "Moyenne déclarée de l'ancien véhicule, prix de scénario fictif", confidence: "moyenne" });
  const [stA, stB] = await db.select().from(schema.stations).where(eq(schema.stations.source, DEMO_SOURCE)).limit(2);
  const plan: [number, number, boolean, string, string][] = [
    [118, 10000, true, "40", "36.00"],
    [100, 10600, true, "45", "40.50"],
    [85, 10950, false, "20", "18.20"],
    [70, 11250, true, "26", "23.66"],
    [50, 11800, true, "42", "38.64"],
    [30, 12400, true, "46", "43.24"],
    [10, 12900, false, "22", "20.24"],
  ];
  for (const [i, [d, odo, full, liters, amount]] of plan.entries()) {
    await createFillup(db, ctx, { vehicleId: vehicle.id, occurredAt: daysAgo(d), odometerKm: String(odo), isFull: full, lines: [{ fuel: "E85", liters, amount }], stationId: (i % 2 ? stB : stA)?.id ?? null, stationLabel: (i % 2 ? stB : stA)?.name ?? null, confirmIssues: true, confirmDuplicate: true }, `demo-${vehicle.id}-${i}`);
  }
  await createProject(db, ctx, { name: "Mon prochain voyage", emoji: "✈️", target: "600", targetDate: daysAgo(-240).toISOString().slice(0, 10), sharePercent: "60", isPrimary: true });
  await createProject(db, ctx, { name: "Vélo électrique", emoji: "🚲", target: "1200", sharePercent: "40" });
  const alloc = await allocateAvailableGains(db, ctx);
  if (alloc.lines[0]) await declareManualTransfer(db, ctx, { projectId: alloc.lines[0].projectId, amount: alloc.lines[0].amount.div(2).toFixed(2), occurredOn: daysAgo(5).toISOString().slice(0, 10), note: "Virement déclaré (démo)" });

  // Espace entreprise fictif
  const org = await createOrganization(db, ctx, { name: "Atelier Démo SARL", kind: "entreprise" });
  const d1 = await demoUser(db, "1");
  const d2 = await demoUser(db, "2");
  await db.insert(schema.memberships).values([
    { organizationId: org.id, userId: d1.userId, role: "driver" },
    { organizationId: org.id, userId: d2.userId, role: "driver" },
  ]);
  const van = await createVehicle(db, ctx, { name: "Utilitaire 1 (démo)", make: "Renault", model: "Kangoo", energy: "diesel", tankCapacityL: "60", organizationId: org.id });
  const car = await createVehicle(db, ctx, { name: "Citadine partagée (démo)", make: "Peugeot", model: "208", energy: "essence", tankCapacityL: "44", organizationId: org.id });
  await assignVehicle(db, ctx, van.id, { userId: d1.userId, startsAt: daysAgo(90), startOdometerKm: "50000" });
  await assignVehicle(db, ctx, car.id, { userId: d1.userId, startsAt: daysAgo(90) });
  await assignVehicle(db, ctx, car.id, { userId: d2.userId, startsAt: daysAgo(90) });
  const vanPlan: [number, number, string, string][] = [[80, 50000, "50", "84.50"], [55, 50800, "48", "81.12"], [25, 51650, "51", "86.70"]];
  for (const [i, [d, odo, l, a]] of vanPlan.entries()) await createFillup(db, d1, { vehicleId: van.id, occurredAt: daysAgo(d), odometerKm: String(odo), isFull: true, lines: [{ fuel: "GAZOLE", liters: l, amount: a }], usage: "professionnel", confirmIssues: true, confirmDuplicate: true }, `demo-van-${van.id}-${i}`);
  await createFillup(db, d1, { vehicleId: car.id, occurredAt: daysAgo(40), odometerKm: "30000", isFull: true, lines: [{ fuel: "SP95_E10", liters: "35", amount: "61.25" }], usage: "professionnel", confirmIssues: true }, `demo-car-${car.id}-1`);
  await createFillup(db, d2, { vehicleId: car.id, occurredAt: daysAgo(12), odometerKm: "30550", isFull: true, lines: [{ fuel: "SP95_E10", liters: "30", amount: "53.40" }], usage: "professionnel", reimbursable: true, confirmIssues: true }, `demo-car-${car.id}-2`);
  await upsertBudget(db, ctx, org.id, { scope: "flotte", period: "mensuel", amount: "400", alertThresholdPercent: 80 });
  const past = daysAgo(65);
  await closePeriod(db, ctx, org.id, past.toISOString().slice(0, 7));
  return ctx;
}

/** Nettoyage des comptes démo de plus de 24 h (tâche planifiée). */
export async function purgeDemoAccounts(db: DB, olderThanHours = 24) {
  const cutoff = new Date(Date.now() - olderThanHours * 3_600_000);
  const orgs = await db.delete(schema.organizations).where(and(eq(schema.organizations.isDemo, true), lt(schema.organizations.createdAt, cutoff))).returning({ id: schema.organizations.id });
  const users = await db.delete(schema.users).where(and(eq(schema.users.isDemo, true), lt(schema.users.createdAt, cutoff))).returning({ id: schema.users.id });
  return { organizations: orgs.length, users: users.length };
}
