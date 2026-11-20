import { describe, expect, it } from "vitest";
import { parseFeedDate } from "@/integrations/fuel-prices";

describe("Dates du flux prix-carburants (heure de Paris notée +00:00)", () => {
  it("hiver : 23:17 à Paris = 22:17 UTC", () => {
    expect(parseFeedDate("2026-11-20T23:17:00+00:00").toISOString()).toBe("2026-11-20T22:17:00.000Z");
  });
  it("été : 09:12 à Paris = 07:12 UTC", () => {
    expect(parseFeedDate("2026-07-14T09:12:00+00:00").toISOString()).toBe("2026-07-14T07:12:00.000Z");
  });
  it("sans fuseau ni secondes", () => {
    expect(parseFeedDate("2026-01-05 08:00").toISOString()).toBe("2026-01-05T07:00:00.000Z");
  });
});
