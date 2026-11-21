import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { sortStations } from "@/server/services/stations";

type V = Parameters<typeof sortStations>[0][number];
const v = (id: string, km: number, price: number | null, stale = false, at = "2026-11-20T10:00:00Z"): V =>
  ({
    station: { id, name: id, brand: null, address: null },
    crowFliesKm: km,
    fuels: [{ fuel: "GAZOLE", price: price === null ? null : new Decimal(price), stale, observedAt: new Date(at) }],
    isFavorite: false,
  }) as unknown as V;

const ids = (l: V[]) => l.map((x) => x.station.id);

describe("Tri des stations", () => {
  const list = [v("B", 1, 1.8, false, "2026-11-20T08:00:00Z"), v("A", 5, 1.7, false, "2026-11-20T12:00:00Z"), v("C", 3, 1.6, true), v("D", 2, null)];

  it("par prix : prix frais croissant, prix anciens ou inconnus à la fin (par distance)", () => {
    expect(ids(sortStations(list, "prix", "GAZOLE"))).toEqual(["A", "B", "D", "C"]);
  });
  it("par distance", () => {
    expect(ids(sortStations(list, "distance", "GAZOLE"))).toEqual(["B", "D", "C", "A"]);
  });
  it("par mise à jour : la plus récente d'abord", () => {
    expect(ids(sortStations(list, "recent", "GAZOLE"))[0]).toBe("A");
  });
  it("par nom", () => {
    expect(ids(sortStations(list, "nom", null))).toEqual(["A", "B", "C", "D"]);
  });
});
