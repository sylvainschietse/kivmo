"use client";

import { useEffect, useRef } from "react";
import type { Map as LeafletMap } from "leaflet";
import "leaflet/dist/leaflet.css";

export interface MapPoint {
  id: string;
  lat: number;
  lng: number;
  name: string;
  /** Prix du carburant choisi, déjà formaté (ex. « 1,789 € »), ou null s'il est inconnu. */
  price: string | null;
  /** Prix daté de plus de 48 h : affiché atténué. */
  stale: boolean;
  priceDate: string | null;
  distance: string | null;
  best: boolean;
}

const TILE_URL = process.env.NEXT_PUBLIC_MAP_TILE_URL || "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const ATTRIBUTION = process.env.NEXT_PUBLIC_MAP_ATTRIBUTION || '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Carte des stations : une étiquette par station avec le prix du carburant choisi. */
export function StationsMap({ points, center, fuelLabel }: { points: MapPoint[]; center: { lat: number; lng: number } | null; fuelLabel: string | null }) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !el.current) return;
      mapRef.current?.remove();
      const map = L.map(el.current, { scrollWheelZoom: false, attributionControl: true });
      mapRef.current = map;
      L.tileLayer(TILE_URL, { maxZoom: 19, attribution: ATTRIBUTION }).addTo(map);

      const bounds = L.latLngBounds([]);
      if (center) {
        L.circleMarker([center.lat, center.lng], { radius: 7, color: "#fff", weight: 2, fillColor: "#2563eb", fillOpacity: 1 })
          .bindTooltip("Vous êtes ici")
          .addTo(map);
        bounds.extend([center.lat, center.lng]);
      }
      for (const p of points) {
        const label = p.price ?? (fuelLabel ? "—" : "⛽");
        const cls = ["kivmo-pin", p.best ? "kivmo-pin-best" : "", p.stale ? "kivmo-pin-stale" : ""].join(" ");
        const icon = L.divIcon({ className: "", html: `<span class="${cls}">${esc(label)}</span>`, iconSize: undefined, iconAnchor: [0, 0] });
        const popup = [
          `<strong>${esc(p.name)}</strong>`,
          p.price && fuelLabel ? `${esc(fuelLabel)} : <strong>${esc(p.price)}</strong>${p.priceDate ? ` <span style="opacity:.7">(${esc(p.priceDate)})</span>` : ""}` : fuelLabel ? `${esc(fuelLabel)} : prix inconnu` : "",
          p.distance ? `À ${esc(p.distance)} à vol d'oiseau` : "",
          `<a href="/stations/${encodeURIComponent(p.id)}">Voir la station</a>`,
        ]
          .filter(Boolean)
          .join("<br>");
        L.marker([p.lat, p.lng], { icon, title: p.name, keyboard: true }).bindPopup(popup).addTo(map);
        bounds.extend([p.lat, p.lng]);
      }
      if (bounds.isValid()) map.fitBounds(bounds, { padding: [30, 30], maxZoom: 15 });
      else map.setView([46.6, 2.4], 5);
    })();
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [points, center, fuelLabel]);

  return <div ref={el} className="kivmo-map h-80 w-full overflow-hidden rounded-2xl border border-line sm:h-96" role="region" aria-label="Carte des stations" data-testid="carte-stations" />;
}
