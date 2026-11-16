import { eq, inArray } from "drizzle-orm";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { schema, type DB, type DBOrTx } from "@/db/client";
import { D, sum } from "@/lib/decimal";
import { FUEL_LABELS, type FuelCode } from "@/domain/types";
import { listFillups, type FillupFilters } from "./fillups";
import { requireOrgRole, type Ctx } from "../authz";
import { audit } from "../audit";
import { deleteStoredFile } from "./attachments";

const APPROVAL_LABELS: Record<string, string> = { not_required: "Sans validation", submitted: "Soumis", to_complete: "À compléter", validated: "Validé", rejected: "Rejeté" };

export interface ExportRow {
  date: string;
  vehicule: string;
  conducteur: string;
  station: string;
  carburants: string;
  litres: string;
  montant_paye: string;
  devise: string;
  usage: string;
  categorie: string;
  reference_justificatif: string;
  statut: string;
  [k: string]: string;
}

/** Lignes d'export : mêmes données et mêmes permissions que l'historique affiché. */
export async function exportRows(db: DBOrTx, ctx: Ctx, filters: FillupFilters): Promise<{ rows: ExportRow[]; accountingKeys: string[] }> {
  if (filters.organizationId) await requireOrgRole(db, ctx, filters.organizationId, "export");
  const all: Awaited<ReturnType<typeof listFillups>>["rows"] = [];
  for (let offset = 0; ; offset += 200) {
    const page = await listFillups(db, ctx, { ...filters, limit: 200, offset });
    all.push(...page.rows);
    if (page.rows.length < 200) break;
  }
  const vehicleIds = [...new Set(all.map((r) => r.vehicleId))];
  const vehicles = vehicleIds.length ? await db.select().from(schema.vehicles).where(inArray(schema.vehicles.id, vehicleIds)) : [];
  const userIds = [...new Set(all.map((r) => r.driverUserId).filter(Boolean) as string[])];
  const users = userIds.length ? await db.select().from(schema.users).where(inArray(schema.users.id, userIds)) : [];
  let accountingKeys: string[] = [];
  if (filters.organizationId) {
    const [org] = await db.select().from(schema.organizations).where(eq(schema.organizations.id, filters.organizationId));
    accountingKeys = org.accountingFields.map((f) => f.key);
  }
  const rows = all.map((r) => {
    const row: ExportRow = {
      date: r.occurredAt.toISOString(),
      vehicule: vehicles.find((v) => v.id === r.vehicleId)?.name ?? "",
      conducteur: users.find((u) => u.id === r.driverUserId)?.email ?? "",
      station: r.stationLabel ?? "",
      carburants: r.lines.map((l) => FUEL_LABELS[l.fuel as FuelCode]).join(" + "),
      litres: sum(r.lines.map((l) => D(l.liters))).toFixed(2),
      montant_paye: D(r.totalPaid).toFixed(2),
      devise: r.currency,
      usage: r.usage,
      categorie: r.category ?? "",
      reference_justificatif: r.receiptAttachmentId ?? "",
      statut: APPROVAL_LABELS[r.approvalStatus] ?? r.approvalStatus,
    };
    for (const k of accountingKeys) row[`compta_${k}`] = r.accountingFields[k] ?? "";
    return row;
  });
  return { rows, accountingKeys };
}

const csvCell = (v: string) => {
  // Neutralise l'injection de formules dans les tableurs.
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[";\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export async function exportCsv(db: DB, ctx: Ctx, filters: FillupFilters) {
  const { rows } = await exportRows(db, ctx, filters);
  const headers = rows[0] ? Object.keys(rows[0]) : ["date", "vehicule", "conducteur", "station", "carburants", "litres", "montant_paye", "devise", "usage", "categorie", "reference_justificatif", "statut"];
  const body = [headers.join(";"), ...rows.map((r) => headers.map((h) => csvCell(r[h] ?? "")).join(";"))].join("\r\n");
  await db.insert(schema.exportJobs).values({ requestedBy: ctx.userId, organizationId: filters.organizationId ?? null, format: "csv", filters: { ...filters }, rowCount: rows.length });
  await audit(db, { actorUserId: ctx.userId, organizationId: filters.organizationId, action: "export.csv", resourceType: "export", details: { rows: rows.length } });
  return "﻿" + body;
}

export async function exportPdf(db: DB, ctx: Ctx, filters: FillupFilters, title: string) {
  const { rows } = await exportRows(db, ctx, filters);
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const clean = (s: string) => s.replace(/[^\x20-\x7E -ÿ]/g, "?");
  let page = pdf.addPage([842, 595]);
  let y = 560;
  page.drawText(clean(`KIVMO - ${title}`), { x: 30, y, size: 14, font: bold, color: rgb(0.03, 0.5, 0.42) });
  y -= 18;
  page.drawText(clean(`Généré le ${new Date().toLocaleString("fr-FR", { timeZone: "Europe/Paris" })} - ${rows.length} pleins - montants payés (ticket)`), { x: 30, y, size: 8, font });
  y -= 20;
  const cols: [keyof ExportRow, string, number][] = [["date", "Date", 30], ["vehicule", "Véhicule", 120], ["conducteur", "Conducteur", 220], ["station", "Station", 360], ["litres", "Litres", 500], ["montant_paye", "Montant", 550], ["devise", "Dev.", 610], ["usage", "Usage", 640], ["statut", "Statut", 710]];
  const header = () => {
    for (const [, label, x] of cols) page.drawText(clean(label), { x, y, size: 8, font: bold });
    y -= 14;
  };
  header();
  for (const r of rows) {
    if (y < 40) {
      page = pdf.addPage([842, 595]);
      y = 560;
      header();
    }
    for (const [key, , x] of cols) {
      const v = key === "date" ? r.date.slice(0, 10) : String(r[key] ?? "");
      page.drawText(clean(v.slice(0, 28)), { x, y, size: 8, font });
    }
    y -= 12;
  }
  const total = sum(rows.map((r) => D(r.montant_paye)));
  y -= 8;
  page.drawText(clean(`Total payé : ${total.toFixed(2)} (devises mélangées non converties)`), { x: 30, y: Math.max(y, 20), size: 9, font: bold });
  await db.insert(schema.exportJobs).values({ requestedBy: ctx.userId, organizationId: filters.organizationId ?? null, format: "pdf", filters: { ...filters }, rowCount: rows.length });
  await audit(db, { actorUserId: ctx.userId, organizationId: filters.organizationId, action: "export.pdf", resourceType: "export", details: { rows: rows.length } });
  return Buffer.from(await pdf.save());
}

/** Export complet des données personnelles (portabilité). */
export async function exportAccount(db: DB, ctx: Ctx) {
  const uid = ctx.userId;
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, uid));
  const vehicles = await db.select().from(schema.vehicles).where(eq(schema.vehicles.ownerUserId, uid));
  const vIds = vehicles.map((v) => v.id);
  const fillups = vIds.length ? await db.select().from(schema.fillups).where(inArray(schema.fillups.vehicleId, vIds)) : [];
  const lines = fillups.length ? await db.select().from(schema.fillupLines).where(inArray(schema.fillupLines.fillupId, fillups.map((f) => f.id))) : [];
  const data = {
    exportedAt: new Date().toISOString(),
    user: { email: user.email, accountKind: user.accountKind, createdAt: user.createdAt },
    profile: (await db.select().from(schema.profiles).where(eq(schema.profiles.userId, uid)))[0] ?? null,
    vehicles,
    conversions: vIds.length ? await db.select().from(schema.conversions).where(inArray(schema.conversions.vehicleId, vIds)) : [],
    referenceProfiles: vIds.length ? await db.select().from(schema.referenceProfiles).where(inArray(schema.referenceProfiles.vehicleId, vIds)) : [],
    fillups: fillups.map((f) => ({ ...f, lines: lines.filter((l) => l.fillupId === f.id) })),
    projects: await db.select().from(schema.projects).where(eq(schema.projects.ownerUserId, uid)),
    allocations: await db.select().from(schema.allocations).where(eq(schema.allocations.ownerUserId, uid)),
    savingsEntries: await db.select().from(schema.savingsEntries).where(eq(schema.savingsEntries.ownerUserId, uid)),
    paymentOrders: (await db.select().from(schema.paymentOrders).where(eq(schema.paymentOrders.ownerUserId, uid))).map((o) => ({ ...o, authorizationUrl: undefined })),
    consents: await db.select().from(schema.consentRecords).where(eq(schema.consentRecords.userId, uid)),
    attachments: (await db.select().from(schema.attachments).where(eq(schema.attachments.ownerUserId, uid))).map((a) => ({ id: a.id, kind: a.kind, mimeType: a.mimeType, sizeBytes: a.sizeBytes, sha256: a.sha256, createdAt: a.createdAt })),
  };
  await audit(db, { actorUserId: uid, action: "account.export", resourceType: "user", resourceId: uid });
  return data;
}

/**
 * Suppression du compte : pièces supprimées du stockage, données personnelles effacées.
 * Les pleins rattachés à une organisation (obligations comptables de l'entreprise) sont
 * conservés et dissociés du compte ; la durée légale de conservation reste à valider (§16).
 */
export async function deleteAccount(db: DB, ctx: Ctx) {
  const uid = ctx.userId;
  const files = await db.select().from(schema.attachments).where(eq(schema.attachments.ownerUserId, uid));
  const orgFillups = await db.select({ id: schema.fillups.id, receipt: schema.fillups.receiptAttachmentId }).from(schema.fillups).where(eq(schema.fillups.createdBy, uid));
  const keepIds = new Set(orgFillups.map((f) => f.receipt).filter(Boolean));
  await db.transaction(async (tx) => {
    await audit(tx, { actorUserId: uid, action: "account.delete", resourceType: "user", resourceId: uid, details: { attachments: files.length } });
    // Les pleins d'organisation restent pour l'entreprise, sans lien nominatif.
    const [placeholder] = await tx.insert(schema.users).values({ email: `supprime-${uid}@invalid.kivmo`, status: "deleted", deletedAt: new Date() }).onConflictDoNothing().returning();
    if (placeholder) {
      await tx.update(schema.fillups).set({ createdBy: placeholder.id, driverUserId: placeholder.id }).where(eq(schema.fillups.createdBy, uid));
      await tx.update(schema.attachments).set({ ownerUserId: placeholder.id }).where(inArray(schema.attachments.id, [...keepIds].length ? ([...keepIds] as string[]) : ["00000000-0000-0000-0000-000000000000"]));
      await tx.update(schema.approvals).set({ decidedBy: placeholder.id }).where(eq(schema.approvals.decidedBy, uid));
      await tx.update(schema.invitations).set({ invitedBy: placeholder.id }).where(eq(schema.invitations.invitedBy, uid));
    }
    await tx.delete(schema.paymentOrders).where(eq(schema.paymentOrders.ownerUserId, uid));
    await tx.delete(schema.users).where(eq(schema.users.id, uid));
  });
  for (const f of files) if (!keepIds.has(f.id)) await deleteStoredFile(f.storageKey);
}
