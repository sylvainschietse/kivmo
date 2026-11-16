"use server";

import { getDb } from "@/db/client";
import { requireSession } from "@/server/session";
import { runAction, str } from "@/server/action";
import { deleteFillup, updateFillup } from "@/server/services/fillups";
import { decideFillup, markReimbursed } from "@/server/services/organizations";
import type { FuelCode } from "@/domain/types";

export async function updateFillupAction(fd: FormData) {
  const { ctx } = await requireSession();
  const id = str(fd, "fillupId");
  await runAction(`/pleins/${id}`, async () => {
    const count = Number(str(fd, "lineCount"));
    const lines = Array.from({ length: count }, (_, i) => ({ fuel: str(fd, `fuel-${i}`) as FuelCode, liters: str(fd, `liters-${i}`) || null, amount: str(fd, `amount-${i}`) || null, unitPrice: null }));
    const closed = str(fd, "closedPeriodCorrection") === "1";
    const r = await updateFillup(
      getDb(),
      ctx,
      id,
      {
        occurredAt: str(fd, "occurredAt") ? new Date(str(fd, "occurredAt")) : undefined,
        odometerKm: str(fd, "odometerKm"),
        isFull: str(fd, "isFull") === "1",
        stationLabel: str(fd, "stationLabel") || null,
        usage: str(fd, "usage") as "personnel",
        referencePrice: str(fd, "referencePrice") || null,
        missedBefore: str(fd, "missedBefore") === "1",
        lines,
        correctionReason: str(fd, "correctionReason") || undefined,
      },
      Number(str(fd, "version")),
      { closedPeriodCorrection: closed },
    );
    if (r.status === "amount_mismatch") return `/pleins/${id}?erreur=${encodeURIComponent(r.message)}`;
    return `/pleins/${id}?ok=${encodeURIComponent("Correction enregistrée : intervalles et totaux recalculés. Les virements déjà exécutés ne sont pas modifiés.")}`;
  });
}

export async function deleteFillupAction(fd: FormData) {
  const { ctx } = await requireSession();
  const id = str(fd, "fillupId");
  await runAction(`/pleins/${id}`, async () => {
    await deleteFillup(getDb(), ctx, id, str(fd, "reason") || "Suppression utilisateur");
    return `/historique?ok=${encodeURIComponent("Plein supprimé (suppression tracée).")}`;
  });
}

export async function decideFillupAction(fd: FormData) {
  const { ctx } = await requireSession();
  const id = str(fd, "fillupId");
  const back = str(fd, "back") || `/pleins/${id}`;
  await runAction(back, async () => {
    await decideFillup(getDb(), ctx, id, str(fd, "decision") as "validated", str(fd, "reason") || undefined);
    return back;
  });
}

export async function markReimbursedAction(fd: FormData) {
  const { ctx } = await requireSession();
  const id = str(fd, "fillupId");
  const back = str(fd, "back") || `/pleins/${id}`;
  await runAction(back, async () => {
    await markReimbursed(getDb(), ctx, id);
    return back;
  });
}
