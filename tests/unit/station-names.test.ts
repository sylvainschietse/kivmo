import { describe, expect, it } from "vitest";
import { matchStations, parseOverpass, stationTitle } from "@/integrations/station-names";

describe("Noms et enseignes des stations (OpenStreetMap)", () => {
  const osm = parseOverpass([
    { type: "node", lat: 48.85, lon: 2.38, tags: { amenity: "fuel", name: "Total Bastille", brand: "TotalEnergies", "ref:FR:prix-carburants": "75011001" } },
    { type: "way", center: { lat: 45.0, lon: 5.0 }, tags: { amenity: "fuel", brand: "E.Leclerc" } },
    { type: "node", lat: 45.0015, lon: 5.0, tags: { amenity: "fuel", brand: "Intermarché" } },
    { type: "node", lat: 44.0, lon: 4.0, tags: { amenity: "fuel" } },
  ]);

  it("garde les stations OSM qui ont un nom ou une enseigne", () => {
    expect(osm).toHaveLength(3);
    expect(osm[1]).toMatchObject({ name: null, brand: "E.Leclerc", lat: 45.0, lng: 5.0 });
  });

  it("rapproche par identifiant officiel, puis par la position la plus proche (moins de 150 m)", () => {
    const m = matchStations(
      [
        { id: "a", sourceId: "75011001", lat: 48.9, lng: 2.4 }, // identifiant connu, position éloignée
        { id: "b", sourceId: "1", lat: 45.0001, lng: 5.0 }, // à 11 m de Leclerc
        { id: "c", sourceId: "2", lat: 45.0003, lng: 5.0 }, // Leclerc déjà pris : Intermarché à 133 m
        { id: "d", sourceId: "3", lat: 46.0, lng: 6.0 }, // rien à proximité
      ],
      osm,
    );
    expect(m.get("a")?.name).toBe("Total Bastille");
    expect(m.get("b")?.brand).toBe("E.Leclerc");
    expect(m.get("c")?.brand).toBe("Intermarché");
    expect(m.has("d")).toBe(false);
  });

  it("affiche le nom, sinon l'enseigne, sinon l'adresse", () => {
    expect(stationTitle({ name: "Total Bastille", brand: "TotalEnergies" })).toBe("Total Bastille");
    expect(stationTitle({ name: null, brand: "E.Leclerc" })).toBe("E.Leclerc");
    expect(stationTitle({ name: null, brand: null, address: "1 rue de Lyon", city: "Paris" })).toBe("1 rue de Lyon, Paris");
    expect(stationTitle({ name: null, brand: null })).toBe("Station");
  });
});
