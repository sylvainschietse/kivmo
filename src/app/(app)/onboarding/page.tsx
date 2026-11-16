import Link from "next/link";
import { onboardingAction } from "@/app/actions/vehicles";
import { Button, Card, ErrorFromQuery, Field, Input, Notice, PageHeader, Select } from "@/components/ui";
import { VehicleFields } from "@/components/forms/vehicle-fields";
import { FUEL_LABELS, FUELS } from "@/domain/types";

export const metadata = { title: "Bienvenue" };

/** Modèle préconfigurable (§20) : aucune donnée d'achat ni prix n'est inventé. */
const CAPTUR = {
  vehicle: { name: "Captur", make: "Renault", model: "Captur", energy: "e85_conversion", engine: "Essence (conversion E85 envisagée)" },
  ref: { label: "Ancien Nissan Qashqai diesel 130 ch", fuel: "GAZOLE", consumption: "6" },
  project: "Mon prochain voyage",
};

export default async function Onboarding({ searchParams }: { searchParams: Promise<{ erreur?: string; modele?: string }> }) {
  const q = await searchParams;
  const m = q.modele === "captur" ? CAPTUR : null;
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Bienvenue sur KIVMO" subtitle="Trois étapes courtes. Seul le véhicule est obligatoire." />
      <ErrorFromQuery error={q.erreur} />
      <div className="mb-4">
        {m ? (
          <Notice tone="info" title="Modèle « Captur E85 » chargé">
            Véhicule, référence diesel 6 L/100 km et projet « Mon prochain voyage » sont préremplis. Aucun achat n&apos;est créé et aucun prix n&apos;est repris : vous saisirez les prix ou les chargerez depuis des sources datées. Les hypothèses (essence 6 L/100, E85 +25 %, conversion hypothétique 360 €, 25 000 km/an) sont proposées dans <Link className="underline" href="/simulations?modele=captur">Simulations</Link>.
          </Notice>
        ) : (
          <Link href="/onboarding?modele=captur" className="text-sm font-semibold text-green underline">Utiliser le modèle « Captur essence → E85, référence Qashqai diesel »</Link>
        )}
      </div>
      <form action={onboardingAction} className="space-y-4">
        <Card title="1. Votre profil">
          <Field label="Vous utilisez KIVMO en tant que" htmlFor="accountKind" hint="Modifiable plus tard sans perte de données.">
            <Select id="accountKind" name="accountKind" defaultValue="particulier">
              <option value="particulier">Particulier</option>
              <option value="independant">Indépendant / artisan / commercial</option>
              <option value="entreprise">Entreprise</option>
            </Select>
          </Field>
        </Card>
        <Card title="2. Votre véhicule">
          <VehicleFields d={m?.vehicle} />
        </Card>
        <Card title="3. Référence de comparaison (facultatif)">
          <p className="mb-3 text-sm text-muted">À quoi comparer vos dépenses ? Ancien véhicule, même véhicule avec un autre carburant ou scénario libre. Sans prix fixe, le prix de référence sera pris des stations datées ou saisi à chaque plein.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Type" htmlFor="refKind">
              <Select id="refKind" name="refKind" defaultValue="ancien_vehicule">
                <option value="ancien_vehicule">Ancien véhicule</option>
                <option value="meme_vehicule_autre_carburant">Même véhicule, autre carburant</option>
                <option value="scenario_libre">Scénario libre</option>
              </Select>
            </Field>
            <Field label="Libellé" htmlFor="refLabel"><Input id="refLabel" name="refLabel" defaultValue={m?.ref.label} /></Field>
            <Field label="Carburant de référence" htmlFor="refFuel">
              <Select id="refFuel" name="refFuel" defaultValue={m?.ref.fuel ?? "GAZOLE"}>
                {FUELS.filter((f) => f !== "ELEC_KWH").map((f) => <option key={f} value={f}>{FUEL_LABELS[f]}</option>)}
              </Select>
            </Field>
            <Field label="Consommation de référence (L/100 km)" htmlFor="refConsumption"><Input id="refConsumption" name="refConsumption" inputMode="decimal" defaultValue={m?.ref.consumption} /></Field>
            <Field label="Prix fixe de scénario (€/L, facultatif)" htmlFor="refFixedPrice" hint="Laisser vide pour utiliser des prix datés."><Input id="refFixedPrice" name="refFixedPrice" inputMode="decimal" /></Field>
          </div>
        </Card>
        <Card title="4. Un projet à financer (facultatif)">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nom du projet" htmlFor="projectName"><Input id="projectName" name="projectName" defaultValue={m?.project} /></Field>
            <Field label="Montant cible (€)" htmlFor="projectTarget"><Input id="projectTarget" name="projectTarget" inputMode="decimal" /></Field>
          </div>
        </Card>
        <Button type="submit" className="w-full sm:w-auto">Terminer la configuration</Button>
      </form>
    </div>
  );
}
