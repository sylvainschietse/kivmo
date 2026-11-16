import { createVehicleAction } from "@/app/actions/vehicles";
import { Button, Card, ErrorFromQuery, PageHeader } from "@/components/ui";
import { VehicleFields } from "@/components/forms/vehicle-fields";

export const metadata = { title: "Nouveau véhicule" };

export default async function NouveauVehicule({ searchParams }: { searchParams: Promise<{ erreur?: string; organizationId?: string }> }) {
  const q = await searchParams;
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Nouveau véhicule" subtitle="Saisie manuelle, toujours disponible." />
      <ErrorFromQuery error={q.erreur} />
      <form action={createVehicleAction}>
        {q.organizationId && <input type="hidden" name="organizationId" value={q.organizationId} />}
        {q.organizationId && <input type="hidden" name="after" value={`/entreprise/${q.organizationId}/vehicules`} />}
        <Card><VehicleFields /></Card>
        <Button type="submit" className="mt-4">Enregistrer</Button>
      </form>
    </div>
  );
}
