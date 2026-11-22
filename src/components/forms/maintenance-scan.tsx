"use client";

import { useRef, useState } from "react";
import { PhotoButton, photoToDataUrl, scanPhotos, type ScanState } from "@/components/photo-scan";
import { kmDigits } from "@/lib/format";

interface MaintenanceScanResult {
  kind: "entretien" | "controle_technique" | "pneus" | "reparation" | null;
  date: string | null;
  odometerKm: string | null;
  totalTtc: string | null;
  garage: string | null;
  summary: string | null;
  nextDueOn: string | null;
  nextDueKm: string | null;
  confidence: "haute" | "moyenne" | "basse";
  note: string | null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Photo d'une facture d'entretien ou d'un procès-verbal de contrôle technique : la facture est
 * conservée avec l'intervention et ses informations pré-remplissent le formulaire, à vérifier.
 * À placer dans le <form> d'ajout d'entretien.
 */
export function MaintenanceScan({ photoScan }: { photoScan: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [invoiceData, setInvoiceData] = useState("");
  const [state, setState] = useState<ScanState>({ status: "idle" });

  function fill(x: MaintenanceScanResult) {
    const form = ref.current?.closest("form");
    if (!form) return [];
    const done: string[] = [];
    const set = (name: string, value: string | null, label?: string) => {
      if (value === null || value === "") return;
      const el = form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null;
      if (!el) return;
      el.value = value;
      el.classList.add("ring-2", "ring-green");
      if (label) done.push(label);
    };
    const today = new Date().toLocaleDateString("sv-SE"); // jour local du téléphone, AAAA-MM-JJ
    set("mode", "evenement");
    set("kind", x.kind, x.kind === "controle_technique" ? "contrôle technique" : x.kind ?? undefined);
    if (x.date && ISO_DATE.test(x.date) && x.date <= today) set("occurredOn", x.date, "date");
    set("cost", x.totalTtc?.replace(".", ",") ?? null, "montant");
    set("odometerKm", kmDigits(x.odometerKm) || null, "kilométrage");
    if (x.nextDueOn && ISO_DATE.test(x.nextDueOn) && x.nextDueOn > today) set("dueOn", x.nextDueOn, "prochaine échéance");
    set("dueOdometerKm", kmDigits(x.nextDueKm) || null, x.nextDueOn ? undefined : "prochaine échéance");
    const note = [x.garage, x.summary].filter(Boolean).join(" · ");
    const noteEl = form.elements.namedItem("note") as HTMLTextAreaElement | null;
    if (note && noteEl && !noteEl.value) set("note", note, "garage et travaux");
    return done;
  }

  async function onPhoto(file: File, signal: AbortSignal) {
    setState({ status: "reading" });
    const data = await photoToDataUrl(file, 1400, 0.75).catch(() => "");
    setInvoiceData(data);
    if (!photoScan) return setState({ status: "done", message: "Facture jointe : elle sera conservée avec l'entretien." });
    const r = await scanPhotos<MaintenanceScanResult>("maintenance", { facture: file }, signal);
    if (!r.ok && r.aborted) {
      setInvoiceData("");
      return setState({ status: "idle" });
    }
    if (signal.aborted) return;
    if (!r.ok) return setState({ status: "done", message: `Facture jointe. ${r.message}` });
    const done = fill(r.result);
    const doubt = r.result.confidence !== "haute" ? " Lecture incertaine : vérifiez bien." : "";
    setState({
      status: "done",
      message: done.length
        ? `Facture jointe. Rempli : ${done.join(", ")}.${doubt}${r.result.note ? ` ${r.result.note}` : ""}`
        : `Facture jointe. ${r.result.note ?? "Rien de lisible à reporter : complétez à la main."}`,
    });
  }

  return (
    <div ref={ref} className="sm:col-span-2">
      <input type="hidden" name="invoiceData" value={invoiceData} />
      <PhotoButton
        label="Photo de la facture ou du contrôle technique"
        hint={photoScan ? "Date, montant, kilométrage, garage et prochaine échéance se remplissent. La facture est conservée." : "La facture est conservée avec l'entretien."}
        state={state}
        preview={invoiceData || null}
        onPhoto={onPhoto}
      />
    </div>
  );
}
