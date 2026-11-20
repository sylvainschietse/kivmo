import { createVehicleAction } from "@/app/actions/vehicles";
import { Button, Card, ErrorFromQuery, PageHeader } from "@/components/ui";
import { VehicleFields } from "@/components/forms/vehicle-fields";
import { VehicleScan } from "@/components/forms/vehicle-scan";
import { ocrAvailable } from "@/integrations/ocr";

export const metadata = { title: "Nouveau véhicule" };

export default async function NouveauVehicule({ searchParams }: { searchParams: Promise<{ erreur?: string; organizationId?: string }> }) {
  const q = await searchParams;
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Nouveau véhicule" subtitle="En photo ou à la main, comme vous préférez." />
      <ErrorFromQuery error={q.erreur} />
      <form action={createVehicleAction}>
        {q.organizationId && <input type="hidden" name="organizationId" value={q.organizationId} />}
        {q.organizationId && <input type="hidden" name="after" value={`/entreprise/${q.organizationId}/vehicules`} />}
        <Card><VehicleScan photoScan={ocrAvailable()} /><VehicleFields /></Card>
        <Button type="submit" className="mt-4">Enregistrer</Button>
      </form>
    </div>
  );
}
