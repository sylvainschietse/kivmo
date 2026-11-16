import { and, desc, eq, isNull, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { requireSession } from "@/server/session";
import { listVehicles } from "@/server/services/vehicles";
import { myOrganizations } from "@/server/services/organizations";
import { EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { FillupForm, type StationOption } from "@/components/forms/fillup-form";
import { stationDetail } from "@/server/services/stations";
import { FUEL_LABELS, type FuelCode } from "@/domain/types";

export const metadata = { title: "Ajouter un plein" };

const DEFAULT_FUEL: Record<string, FuelCode> = { essence: "SP95_E10", diesel: "GAZOLE", e85_flex: "E85", e85_conversion: "E85", gpl: "GPL", hybride: "SP95_E10", hybride_rechargeable: "SP95_E10", electrique: "ELEC_KWH" };

export default async function NouveauPlein({ searchParams }: { searchParams: Promise<{ station?: string }> }) {
  const q = await searchParams;
  const { ctx } = await requireSession();
  const db = getDb();
  const personal = await listVehicles(db, ctx);
  const orgs = await myOrganizations(db, ctx);
  const orgVehicles = (await Promise.all(orgs.filter((o) => o.org.kind !== "partenaire").map((o) => listVehicles(db, ctx, { organizationId: o.org.id })))).flat();
  const vehicles = [...personal, ...orgVehicles];
  if (!vehicles.length) return <EmptyState title="Aucun véhicule" action={<LinkButton href="/onboarding">Ajouter un véhicule</LinkButton>}>Ajoutez d&apos;abord un véhicule.</EmptyState>;
  const [profile] = await db.select().from(schema.profiles).where(eq(schema.profiles.userId, ctx.userId));
  const ids = vehicles.map((v) => v.id);
  const refs = await db.select().from(schema.referenceProfiles).where(inArray(schema.referenceProfiles.vehicleId, ids)).orderBy(desc(schema.referenceProfiles.profileVersion));
  const referenceNeedsPrice: Record<string, { fuel: FuelCode; label: string } | null> = {};
  const lastOdometer: Record<string, string | null> = {};
  for (const v of vehicles) {
    const r = refs.find((x) => x.vehicleId === v.id);
    referenceNeedsPrice[v.id] = r && r.priceMode === "observed" ? { fuel: r.fuel as FuelCode, label: FUEL_LABELS[r.fuel as FuelCode] } : null;
    const [last] = await db.select({ odo: schema.fillups.odometerKm }).from(schema.fillups).where(and(eq(schema.fillups.vehicleId, v.id), isNull(schema.fillups.deletedAt))).orderBy(desc(schema.fillups.occurredAt)).limit(1);
    lastOdometer[v.id] = last ? String(Math.round(Number(last.odo))) : null;
  }
  let initialStation: StationOption | null = null;
  if (q.station && /^[0-9a-f-]{36}$/.test(q.station)) {
    const v = await stationDetail(db, ctx, q.station, null).catch(() => null);
    if (v) initialStation = { id: v.station.id, name: v.station.name ?? v.station.address, address: [v.station.address, v.station.postalCode, v.station.city].filter(Boolean).join(" "), crowFliesKm: null, isDemo: v.station.isDemo, fuels: v.fuels.map((f) => ({ fuel: f.fuel, price: f.price?.toString() ?? null, observedAt: f.observedAt?.toISOString() ?? null, stale: f.stale, availability: f.availability })) };
  }
  const def = vehicles.find((v) => v.id === profile?.activeVehicleId) ?? vehicles[0];
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Ajouter un plein" subtitle="Saisie rapide : véhicule, compteur, deux valeurs parmi litres / prix / total." />
      <FillupForm
        vehicles={vehicles.map((v) => ({ id: v.id, name: v.organizationId ? `${v.name} (entreprise)` : v.name, energy: v.energy, organizationId: v.organizationId }))}
        defaultVehicleId={def.id}
        defaultFuel={DEFAULT_FUEL[def.energy] ?? "SP95_E10"}
        referenceNeedsPrice={referenceNeedsPrice}
        lastOdometer={lastOdometer}
        initialStation={initialStation}
      />
    </div>
  );
}
