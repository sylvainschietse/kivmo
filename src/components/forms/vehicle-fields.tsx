import { Field, Input, Select } from "@/components/ui";

export const ENERGY_OPTIONS: [string, string][] = [
  ["essence", "Essence"],
  ["diesel", "Diesel"],
  ["e85_flex", "E85 d'origine (flex)"],
  ["e85_conversion", "Essence convertie E85"],
  ["gpl", "GPL"],
  ["hybride", "Hybride"],
  ["hybride_rechargeable", "Hybride rechargeable"],
  ["electrique", "Électrique"],
];

export type VehicleDefaults = Partial<Record<"name" | "make" | "model" | "year" | "engine" | "energy" | "tankCapacityL" | "initialOdometerKm" | "plate", string | number | null>>;

export function VehicleFields({ d = {} }: { d?: VehicleDefaults }) {
  const v = (k: keyof VehicleDefaults) => (d[k] ?? "") as string;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Nom du véhicule" htmlFor="name"><Input id="name" name="name" required defaultValue={v("name")} placeholder="Ma voiture" /></Field>
      <Field label="Énergie" htmlFor="energy">
        <Select id="energy" name="energy" defaultValue={v("energy") || "essence"}>
          {ENERGY_OPTIONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </Select>
      </Field>
      <Field label="Marque" htmlFor="make"><Input id="make" name="make" defaultValue={v("make")} /></Field>
      <Field label="Modèle" htmlFor="model"><Input id="model" name="model" defaultValue={v("model")} /></Field>
      <Field label="Année" htmlFor="year"><Input id="year" name="year" inputMode="numeric" defaultValue={v("year")} /></Field>
      <Field label="Motorisation" htmlFor="engine"><Input id="engine" name="engine" defaultValue={v("engine")} placeholder="ex. TCe 130" /></Field>
      <Field label="Capacité du réservoir (L, facultatif)" htmlFor="tankCapacityL" hint="Sert à repérer les saisies incohérentes."><Input id="tankCapacityL" name="tankCapacityL" inputMode="decimal" defaultValue={v("tankCapacityL")} /></Field>
      <Field label="Kilométrage actuel" htmlFor="initialOdometerKm"><Input id="initialOdometerKm" name="initialOdometerKm" inputMode="numeric" defaultValue={v("initialOdometerKm")} /></Field>
      <Field label="Immatriculation (facultatif)" htmlFor="plate" hint="Recherche par immatriculation : à connecter. La saisie manuelle reste toujours possible."><Input id="plate" name="plate" defaultValue={v("plate")} autoCapitalize="characters" /></Field>
    </div>
  );
}
