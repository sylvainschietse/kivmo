"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb, schema } from "@/db/client";
import { requireSession } from "@/server/session";
import { runAction, str, optStr } from "@/server/action";
import { addReferenceProfile, archiveVehicle, createVehicle, declareOdometerReplacement, setActiveVehicle, setConversion, setVehiclePhoto, updateVehicle, decodePhotoDataUrl } from "@/server/services/vehicles";
import { storeAttachment } from "@/server/services/attachments";
import { createProject } from "@/server/services/savings";
import { requireVehicle } from "@/server/authz";
import { audit } from "@/server/audit";
import type { FuelCode } from "@/domain/types";

function vehicleFromForm(fd: FormData) {
  return {
    name: str(fd, "name"),
    make: optStr(fd, "make"),
    model: optStr(fd, "model"),
    year: optStr(fd, "year") ? Number(str(fd, "year")) : null,
    engine: optStr(fd, "engine"),
    energy: str(fd, "energy") as "essence",
    tankCapacityL: optStr(fd, "tankCapacityL")?.replace(",", ".") ?? null,
    initialOdometerKm: optStr(fd, "initialOdometerKm")?.replace(/\s/g, "") ?? null,
    plate: optStr(fd, "plate"),
    currency: str(fd, "currency") || "EUR",
    country: str(fd, "country") || "FR",
    organizationId: optStr(fd, "organizationId"),
    teamId: optStr(fd, "teamId"),
  };
}

export async function createVehicleAction(fd: FormData) {
  const { ctx } = await requireSession();
  const back = str(fd, "back") || "/garage/nouveau";
  await runAction(back, async () => {
    const v = await createVehicle(getDb(), ctx, vehicleFromForm(fd));
    if (str(fd, "photoData")) await setVehiclePhoto(getDb(), ctx, v.id, str(fd, "photoData"));
    revalidatePath("/garage");
    return str(fd, "after") || `/garage/${v.id}?ok=${encodeURIComponent("Véhicule enregistré.")}`;
  });
}

export async function updateVehicleAction(fd: FormData) {
  const { ctx } = await requireSession();
  const id = str(fd, "vehicleId");
  await runAction(`/garage/${id}`, async () => {
    const { organizationId: _o, ...patch } = vehicleFromForm(fd);
    void _o;
    await updateVehicle(getDb(), ctx, id, patch, Number(str(fd, "version")));
    if (str(fd, "photoData")) await setVehiclePhoto(getDb(), ctx, id, str(fd, "photoData"));
    revalidatePath("/garage");
    return `/garage/${id}?ok=${encodeURIComponent("Modifications enregistrées.")}`;
  });
}

export async function archiveVehicleAction(fd: FormData) {
  const { ctx } = await requireSession();
  const id = str(fd, "vehicleId");
  await runAction(`/garage/${id}`, async () => {
    await archiveVehicle(getDb(), ctx, id, str(fd, "archived") === "1");
    return "/garage";
  });
}

export async function setActiveVehicleAction(fd: FormData) {
  const { ctx } = await requireSession();
  await runAction("/accueil", async () => {
    await setActiveVehicle(getDb(), ctx, str(fd, "vehicleId"));
    return str(fd, "back") || "/accueil";
  });
}

export async function addReferenceAction(fd: FormData) {
  const { ctx } = await requireSession();
  const id = str(fd, "vehicleId");
  await runAction(`/garage/${id}`, async () => {
    await addReferenceProfile(getDb(), ctx, id, {
      kind: str(fd, "kind") as "ancien_vehicule",
      label: str(fd, "label"),
      fuel: str(fd, "fuel") as FuelCode,
      consumptionL100: str(fd, "consumptionL100"),
      priceMode: str(fd, "priceMode") as "fixed",
      fixedPrice: optStr(fd, "fixedPrice"),
      effectiveFrom: new Date(str(fd, "effectiveFrom") || Date.now()),
      method: optStr(fd, "method"),
      confidence: (str(fd, "confidence") || "moyenne") as "moyenne",
    });
    return `/garage/${id}?ok=${encodeURIComponent("Nouvelle version de la référence enregistrée. Les résultats ont été recalculés.")}`;
  });
}

export async function setConversionAction(fd: FormData) {
  const { ctx } = await requireSession();
  const id = str(fd, "vehicleId");
  await runAction(`/garage/${id}`, async () => {
    await setConversion(getDb(), ctx, id, { declaredType: str(fd, "declaredType"), date: str(fd, "date"), odometerKm: str(fd, "odometerKm"), cost: str(fd, "cost"), provider: optStr(fd, "provider"), note: optStr(fd, "note") });
    return `/garage/${id}?ok=${encodeURIComponent("Conversion enregistrée (déclarative).")}`;
  });
}

export async function odometerReplacementAction(fd: FormData) {
  const { ctx } = await requireSession();
  const id = str(fd, "vehicleId");
  await runAction(`/garage/${id}`, async () => {
    await declareOdometerReplacement(getDb(), ctx, id, { occurredAt: new Date(str(fd, "occurredAt")), oldReadingKm: str(fd, "oldReadingKm"), newReadingKm: str(fd, "newReadingKm"), note: optStr(fd, "note") ?? undefined });
    return `/garage/${id}?ok=${encodeURIComponent("Remplacement du compteur historisé.")}`;
  });
}

export async function addMaintenanceAction(fd: FormData) {
  const { ctx } = await requireSession();
  const id = str(fd, "vehicleId");
  await runAction(`/garage/${id}`, async () => {
    const db = getDb();
    const { vehicle } = await requireVehicle(db, ctx, id, "write");
    const kind = str(fd, "kind");
    const due = { dueOn: optStr(fd, "dueOn"), dueOdometerKm: optStr(fd, "dueOdometerKm")?.replace(/\s/g, "") ?? null };
    if (str(fd, "mode") === "rappel") {
      await db.insert(schema.reminders).values({ vehicleId: id, kind, ...due });
    } else {
      // Facture ou procès-verbal photographié : conservé en privé et rattaché à l'intervention.
      let attachmentId: string | null = null;
      if (str(fd, "invoiceData")) {
        const photo = decodePhotoDataUrl(str(fd, "invoiceData"), 2 * 1024 * 1024);
        attachmentId = (await storeAttachment(db, ctx, { kind: "entretien", ...photo, organizationId: vehicle.organizationId })).attachment.id;
      }
      await db.insert(schema.maintenanceEvents).values({ vehicleId: id, kind, occurredOn: str(fd, "occurredOn"), odometerKm: optStr(fd, "odometerKm")?.replace(/\s/g, "") ?? null, cost: optStr(fd, "cost")?.replace(",", ".") ?? null, downtimeDays: optStr(fd, "downtimeDays") ? Number(str(fd, "downtimeDays")) : null, note: optStr(fd, "note"), attachmentId });
      // L'intervention réalisée solde les échéances encore ouvertes de même nature (ex. le CT attendu).
      await db.update(schema.reminders).set({ doneAt: new Date(), updatedAt: new Date() }).where(and(eq(schema.reminders.vehicleId, id), eq(schema.reminders.kind, kind), isNull(schema.reminders.doneAt)));
      // Prochaine échéance indiquée avec l'intervention (ex. date limite du prochain contrôle technique).
      if (due.dueOn || due.dueOdometerKm) await db.insert(schema.reminders).values({ vehicleId: id, kind, ...due });
    }
    await audit(db, { actorUserId: ctx.userId, action: "maintenance.add", resourceType: "vehicle", resourceId: id, details: { kind } });
    return `/garage/${id}?ok=${encodeURIComponent("Entretien enregistré.")}#entretien`;
  });
}

export async function completeReminderAction(fd: FormData) {
  const { ctx } = await requireSession();
  const id = str(fd, "vehicleId");
  await runAction(`/garage/${id}`, async () => {
    const db = getDb();
    await requireVehicle(db, ctx, id, "write");
    await db.update(schema.reminders).set({ doneAt: new Date() }).where(eq(schema.reminders.id, str(fd, "reminderId")));
    return `/garage/${id}#entretien`;
  });
}

/** Onboarding : véhicule, référence facultative, projet facultatif (§5). Scénario §20 proposé comme modèle. */
export async function onboardingAction(fd: FormData) {
  const { ctx } = await requireSession();
  await runAction("/onboarding", async () => {
    const db = getDb();
    const kind = str(fd, "accountKind") as "particulier";
    await db.update(schema.users).set({ accountKind: kind || "particulier", onboardedAt: new Date(), updatedAt: new Date() }).where(eq(schema.users.id, ctx.userId));
    const v = await createVehicle(db, ctx, vehicleFromForm(fd));
    if (str(fd, "photoData")) await setVehiclePhoto(db, ctx, v.id, str(fd, "photoData"));
    if (str(fd, "refConsumption")) {
      await addReferenceProfile(db, ctx, v.id, {
        kind: (str(fd, "refKind") || "ancien_vehicule") as "ancien_vehicule",
        label: str(fd, "refLabel") || "Référence",
        fuel: (str(fd, "refFuel") || "GAZOLE") as FuelCode,
        consumptionL100: str(fd, "refConsumption"),
        priceMode: optStr(fd, "refFixedPrice") ? "fixed" : "observed",
        fixedPrice: optStr(fd, "refFixedPrice"),
        effectiveFrom: new Date(Date.now() - 365 * 86_400_000),
        method: "Saisie lors de l'inscription",
        confidence: "moyenne",
      });
    }
    if (str(fd, "projectName")) await createProject(db, ctx, { name: str(fd, "projectName"), target: optStr(fd, "projectTarget"), isPrimary: true });
    return "/accueil?ok=" + encodeURIComponent("Configuration terminée. Enregistrez votre premier plein complet : il servira de point de départ.");
  });
}
