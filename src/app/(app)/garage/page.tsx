import Link from "next/link";
import { getDb } from "@/db/client";
import { requireSession } from "@/server/session";
import { listVehicles } from "@/server/services/vehicles";
import { Badge, Card, EmptyState, LinkButton, OkFromQuery, PageHeader } from "@/components/ui";
import { ENERGY_OPTIONS } from "@/components/forms/vehicle-fields";
import { formatKm } from "@/lib/format";

export const metadata = { title: "Garage" };

export default async function Garage({ searchParams }: { searchParams: Promise<{ ok?: string }> }) {
  const { ctx } = await requireSession();
  const q = await searchParams;
  const vehicles = await listVehicles(getDb(), ctx, { includeArchived: true });
  const energy = Object.fromEntries(ENERGY_OPTIONS);
  return (
    <div>
      <PageHeader title="Garage" subtitle="Vos véhicules, références de comparaison, conversion, compteur et entretien." action={<LinkButton href="/garage/nouveau">Ajouter un véhicule</LinkButton>} />
      <OkFromQuery ok={q.ok} />
      {vehicles.length === 0 ? (
        <EmptyState title="Aucun véhicule" action={<LinkButton href="/garage/nouveau">Ajouter un véhicule</LinkButton>} />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {vehicles.map((v) => (
            <li key={v.id}>
              <Link href={`/garage/${v.id}`} className="block h-full">
                <Card className="h-full hover:border-green">
                  <p className="text-lg font-bold">{v.name}</p>
                  <p className="text-sm text-muted">{[v.make, v.model, v.year].filter(Boolean).join(" ") || "—"}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Badge>{energy[v.energy] ?? v.energy}</Badge>
                    {v.archivedAt && <Badge tone="warn">Archivé</Badge>}
                    <Badge tone="info">Départ {formatKm(v.initialOdometerKm)}</Badge>
                  </div>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
