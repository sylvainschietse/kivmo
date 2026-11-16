"use server";

import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { requireSession } from "@/server/session";
import { runAction, str } from "@/server/action";
import { AppError } from "@/server/errors";
import { audit } from "@/server/audit";
import { importFuelPrices } from "@/integrations/fuel-prices";
import { env } from "@/server/env";

async function requireAdmin() {
  const s = await requireSession();
  if (!s.ctx.isPlatformAdmin) throw new AppError("FORBIDDEN", "Réservé à l'administration KIVMO.");
  return s;
}

export async function triggerImportAction(fd: FormData) {
  await runAction("/admin", async () => {
    const { ctx } = await requireAdmin();
    if (!env.fuelPricesEnabled) throw new AppError("NOT_CONNECTED", "Connecteur prix-carburants non activé (FUEL_PRICES_SOURCE).");
    const department = str(fd, "department");
    if (!/^(\d{2,3}|2[AB])$/.test(department)) throw new AppError("VALIDATION", "Département invalide.");
    let r;
    try {
      r = await importFuelPrices(getDb(), { department });
    } catch (e) {
      throw new AppError("UPSTREAM", `Import échoué : ${(e as Error).message}`);
    }
    await audit(getDb(), { actorUserId: ctx.userId, action: "admin.import_prices", resourceType: "integration", resourceId: "fuel_prices" });
    return `/admin?ok=${encodeURIComponent(`Import terminé : ${JSON.stringify(r).slice(0, 160)}`)}`;
  });
}

export async function verifyPartnerAction(fd: FormData) {
  await runAction("/admin", async () => {
    const { ctx } = await requireAdmin();
    const db = getDb();
    const orgId = str(fd, "organizationId");
    const [org] = await db.select().from(schema.organizations).where(eq(schema.organizations.id, orgId));
    if (!org || org.kind !== "partenaire") throw new AppError("NOT_FOUND", "Organisation partenaire introuvable.");
    const [existing] = await db.select().from(schema.partners).where(eq(schema.partners.organizationId, orgId));
    const services = str(fd, "services").split(",").map((s) => s.trim()).filter(Boolean);
    const zones = str(fd, "zones").split(",").map((s) => s.trim()).filter(Boolean);
    if (existing) await db.update(schema.partners).set({ verifiedAt: new Date(), services, zones, city: str(fd, "city") || existing.city, updatedAt: new Date() }).where(eq(schema.partners.id, existing.id));
    else await db.insert(schema.partners).values({ organizationId: orgId, name: org.name, kind: "garage", services, zones, city: str(fd, "city") || null, verifiedAt: new Date(), isDemo: org.isDemo });
    await audit(db, { actorUserId: ctx.userId, action: "admin.partner_verify", resourceType: "organization", resourceId: orgId });
    return `/admin?ok=${encodeURIComponent("Professionnel vérifié.")}`;
  });
}
