"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

/** Demande la position seulement au clic ; un refus laisse la recherche par ville disponible. */
export function LocateButton({ path = "/stations" }: { path?: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const locate = () => {
    if (!("geolocation" in navigator)) return setMsg("Géolocalisation indisponible sur cet appareil : recherchez par ville ou code postal.");
    setBusy(true);
    setMsg(null);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setBusy(false);
        const q = new URLSearchParams(params.toString());
        q.set("lat", p.coords.latitude.toFixed(5));
        q.set("lng", p.coords.longitude.toFixed(5));
        q.set("precision", String(Math.round(p.coords.accuracy)));
        q.delete("q");
        router.push(`${path}?${q}`);
      },
      (e) => {
        setBusy(false);
        setMsg(e.code === e.PERMISSION_DENIED ? "Position refusée : aucune donnée n'est utilisée. Recherchez par ville ou code postal." : "Position introuvable pour l'instant : recherchez par ville ou code postal.");
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
    );
  };
  return (
    <div>
      <button type="button" onClick={locate} disabled={busy} className="tap rounded-xl bg-green px-4 text-sm font-semibold text-green-ink disabled:opacity-60">
        {busy ? "Localisation…" : "Autour de moi"}
      </button>
      {msg && <p role="status" className="mt-2 text-sm text-warn">{msg}</p>}
    </div>
  );
}
