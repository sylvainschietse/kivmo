"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db/client";
import { requireSession } from "@/server/session";
import { runAction, str, optStr } from "@/server/action";
import { moderateReport, reportStation, toggleFavorite } from "@/server/services/stations";
import type { FuelCode } from "@/domain/types";

export async function toggleFavoriteAction(fd: FormData) {
  const { ctx } = await requireSession();
  const back = str(fd, "back") || "/stations";
  await runAction(back, async () => {
    const on = await toggleFavorite(getDb(), ctx, str(fd, "stationId"));
    revalidatePath("/stations");
    const sep = back.includes("?") ? "&" : "?";
    return `${back}${sep}ok=${encodeURIComponent(on ? "Station ajoutée aux favoris." : "Station retirée des favoris.")}`;
  });
}

export async function reportStationAction(fd: FormData) {
  const { ctx } = await requireSession();
  const id = str(fd, "stationId");
  await runAction(`/stations/${id}`, async () => {
    await reportStation(getDb(), ctx, { stationId: id, fuel: (optStr(fd, "fuel") as FuelCode) ?? null, kind: str(fd, "kind") as "rupture", reportedPrice: optStr(fd, "reportedPrice") });
    return `/stations/${id}?ok=${encodeURIComponent("Merci : signalement enregistré, visible 48 h et modérable.")}`;
  });
}

export async function moderateReportAction(fd: FormData) {
  const { ctx } = await requireSession();
  await runAction("/admin", async () => {
    await moderateReport(getDb(), ctx, str(fd, "reportId"), str(fd, "decision") as "accepte", optStr(fd, "note") ?? undefined);
    return `/admin?ok=${encodeURIComponent("Signalement modéré.")}`;
  });
}
