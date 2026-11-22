"use client";

import { useRef, useState } from "react";
import { PhotoButton, photoToDataUrl, scanPhotos, type ScanState } from "@/components/photo-scan";

interface VehicleScanResult {
  plate: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  engine: string | null;
  energy: string | null;
  tankCapacityL: string | null;
  confidence: "haute" | "moyenne" | "basse";
  note: string | null;
}

const titleCase = (s: string) => s.toLowerCase().replace(/(^|[\s-])\p{L}/gu, (c) => c.toUpperCase());

/**
 * Photos du véhicule : la carte grise et/ou la voiture avec sa plaque pré-remplissent la fiche,
 * et la photo de la voiture sert de vignette. À placer dans le <form> qui contient VehicleFields.
 */
export function VehicleScan({ photoScan, currentPhotoUrl }: { photoScan: boolean; currentPhotoUrl?: string | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const [photoData, setPhotoData] = useState("");
  const [state, setState] = useState<Record<"carte_grise" | "vehicule", ScanState>>({ carte_grise: { status: "idle" }, vehicule: { status: "idle" } });

  function fill(x: VehicleScanResult, onlyEmpty: boolean) {
    const form = ref.current?.closest("form");
    if (!form) return [];
    const done: string[] = [];
    const set = (name: string, value: string | number | null, label: string) => {
      if (value === null || value === "") return;
      const el = form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | null;
      if (!el || (onlyEmpty && (el.value || name === "energy"))) return;
      el.value = String(value);
      el.classList.add("ring-2", "ring-green");
      done.push(label);
    };
    set("make", x.make ? titleCase(x.make) : null, "marque");
    set("model", x.model ? titleCase(x.model) : null, "modèle");
    set("year", x.year, "année");
    set("engine", x.engine, "motorisation");
    if (x.energy) set("energy", x.energy, "énergie");
    set("tankCapacityL", x.tankCapacityL?.replace(".", ",") ?? null, "réservoir");
    set("plate", x.plate?.toUpperCase() ?? null, "immatriculation");
    const name = form.elements.namedItem("name") as HTMLInputElement | null;
    if (name && !name.value && (x.make || x.model)) {
      name.value = titleCase([x.make, x.model].filter(Boolean).join(" "));
      name.classList.add("ring-2", "ring-green");
    }
    return done;
  }

  async function read(kind: "carte_grise" | "vehicule", file: File, signal: AbortSignal) {
    if (kind === "vehicule") {
      photoToDataUrl(file, 640, 0.8).then(setPhotoData).catch(() => undefined);
      if (!photoScan) return setState((s) => ({ ...s, vehicule: { status: "done", message: "Photo ajoutée : elle servira de vignette." } }));
    }
    setState((s) => ({ ...s, [kind]: { status: "reading" } }));
    const r = await scanPhotos<VehicleScanResult>("vehicle", { [kind]: file }, signal);
    if (!r.ok && r.aborted) {
      if (kind === "vehicule") setPhotoData("");
      return setState((s) => ({ ...s, [kind]: { status: "idle" } }));
    }
    if (signal.aborted) return;
    if (!r.ok) return setState((s) => ({ ...s, [kind]: { status: kind === "vehicule" ? "done" : "error", message: kind === "vehicule" ? `Photo ajoutée en vignette. ${r.message}` : r.message } }));
    // La carte grise fait foi : elle remplace ; la photo de la voiture ne complète que les champs vides.
    const done = fill(r.result, kind === "vehicule");
    const doubt = r.result.confidence !== "haute" ? " Lecture incertaine : vérifiez bien." : "";
    const prefix = kind === "vehicule" ? "Photo ajoutée en vignette. " : "";
    setState((s) => ({
      ...s,
      [kind]: done.length
        ? { status: "done", message: `${prefix}Rempli : ${done.join(", ")}.${doubt}${r.result.note ? ` ${r.result.note}` : ""}` }
        : { status: kind === "vehicule" ? "done" : "error", message: `${prefix}${r.result.note ?? "Rien de lisible à reporter sur la fiche."}` },
    }));
  }

  return (
    <div ref={ref} className="mb-4 space-y-2">
      <input type="hidden" name="photoData" value={photoData} />
      <p className="text-sm text-muted">
        {photoScan ? "Prenez la carte grise et la voiture en photo : la fiche se remplit toute seule, vous vérifiez avant d'enregistrer." : "Ajoutez une photo de la voiture pour la reconnaître d'un coup d'œil."}
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {photoScan && <PhotoButton label="Photo de la carte grise" hint="Marque, modèle, année, énergie, immatriculation." state={state.carte_grise} onPhoto={(f, sig) => read("carte_grise", f, sig)} />}
        <PhotoButton label="Photo de la voiture" hint={photoScan ? "Avec la plaque visible. Sert aussi de vignette." : "Sert de vignette dans le garage."} state={state.vehicule} preview={photoData || currentPhotoUrl || null} onPhoto={(f, sig) => read("vehicule", f, sig)} />
      </div>
    </div>
  );
}
