import Link from "next/link";
import { stationTitle } from "@/integrations/station-names";
import type { StationView } from "@/server/services/stations";
import { AVAILABILITY_LABELS } from "@/server/services/stations";
import { formatAge, formatUnitPrice } from "@/lib/format";
import { FUEL_LABELS, type FuelCode } from "@/domain/types";
import { Badge } from "@/components/ui";

export function StationCard({ v, fuel, rank }: { v: StationView; fuel?: FuelCode | null; rank?: number }) {
  const shown = fuel ? v.fuels.filter((f) => f.fuel === fuel) : v.fuels;
  return (
    <Link href={`/stations/${v.station.id}`} className="block rounded-2xl border border-line bg-surface p-3 hover:border-green">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold">{rank ? <span className="mr-1 text-muted">{rank}.</span> : null}{stationTitle(v.station)} {v.isFavorite && <span aria-label="Favori">★</span>}</p>
          {v.station.brand && v.station.name && v.station.brand !== v.station.name && <p className="text-xs font-semibold text-muted">{v.station.brand}</p>}
          <p className="truncate text-sm text-muted">{[v.station.address, v.station.postalCode, v.station.city].filter(Boolean).join(" ")}</p>
        </div>
        <div className="shrink-0 text-right text-sm">
          {v.crowFliesKm != null && <p className="num font-semibold">{v.crowFliesKm.toFixed(1).replace(".", ",")} km</p>}
          <p className="text-xs text-muted">à vol d&apos;oiseau</p>
        </div>
      </div>
      <ul className="mt-2 flex flex-wrap gap-2">
        {shown.map((f) => (
          <li key={f.fuel} className="rounded-xl bg-surface-2 px-2 py-1 text-sm">
            <span className="font-semibold">{FUEL_LABELS[f.fuel]}</span>{" "}
            <span className="num">{f.price ? formatUnitPrice(f.price) : "prix inconnu"}</span>
            {f.observedAt && <span className={`block text-xs ${f.stale ? "text-warn" : "text-muted"}`}>{f.stale ? "Ancien : " : ""}{formatAge(f.observedAt)}</span>}
            {f.availability === "rupture_signalee" ? <Badge tone="loss">{AVAILABILITY_LABELS[f.availability]}</Badge> : f.availability === "disponible_signale" ? <Badge tone="gain">{AVAILABILITY_LABELS[f.availability]}</Badge> : null}
          </li>
        ))}
        {shown.length === 0 && <li className="text-sm text-muted">Carburant non proposé</li>}
      </ul>
      {v.station.isDemo && <p className="mt-1"><Badge tone="lime">Station de démonstration</Badge></p>}
    </Link>
  );
}
