import { describe, expect, it } from "vitest";
import { kmDigits } from "@/lib/format";
import { dayInZone, endOfDayInZone, startOfMonthInZone, zonedMidnight } from "@/lib/dates";
import { safeNextPath } from "@/server/auth";

describe("kilométrage lu sur photo", () => {
  it("ignore le dixième au lieu de le coller au nombre", () => {
    expect(kmDigits("123456.7")).toBe("123456");
    expect(kmDigits("123 456,7 km")).toBe("123456");
  });
  it("garde les séparateurs de milliers", () => {
    expect(kmDigits("123.456")).toBe("123456");
    expect(kmDigits("123 456")).toBe("123456");
    expect(kmDigits("98765")).toBe("98765");
  });
  it("vide si rien n'est lu", () => {
    expect(kmDigits(null)).toBe("");
    expect(kmDigits("")).toBe("");
  });
});

describe("adresse de retour après connexion", () => {
  it("accepte un chemin du site", () => {
    expect(safeNextPath("/stations?tri=prix")).toBe("/stations?tri=prix");
    expect(safeNextPath("/invitation?token=abc")).toBe("/invitation?token=abc");
  });
  it("refuse les adresses qui mènent vers un autre site", () => {
    for (const bad of ["//evil.com", "/\\evil.com", "/\\/evil.com", "https://evil.com", "/\tevil", "javascript:alert(1)", "", null]) {
      expect(safeNextPath(bad)).toBe("/accueil");
    }
  });
});

describe("dates en heure de Paris", () => {
  it("un plein du 1er décembre à 0 h 30 (Paris) tombe en décembre", () => {
    const at = new Date("2026-11-30T23:30:00Z"); // 1er décembre 0 h 30 à Paris
    expect(dayInZone(at)).toBe("2026-12-01");
    expect(startOfMonthInZone(at).toISOString()).toBe("2026-11-30T23:00:00.000Z");
  });
  it("gère l'heure d'été", () => {
    expect(zonedMidnight(2026, 7, 1).toISOString()).toBe("2026-06-30T22:00:00.000Z");
    expect(endOfDayInZone("2026-07-01").toISOString()).toBe("2026-07-01T21:59:59.999Z");
  });
  it("fuseau invalide : repli sur Paris", () => {
    expect(dayInZone(new Date("2026-11-30T23:30:00Z"), "Pas/Un_Fuseau")).toBe("2026-12-01");
  });
});
