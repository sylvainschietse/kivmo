import { api } from "@/server/api";
import { exportCsv, exportPdf } from "@/server/services/exports";
import type { FuelCode } from "@/domain/types";

export const GET = api(async ({ req, db, ctx }) => {
  const q = req.nextUrl.searchParams;
  const filters = {
    organizationId: q.get("organizationId") ?? undefined,
    vehicleId: q.get("vehicleId") ?? undefined,
    from: q.get("from") ? new Date(q.get("from")!) : undefined,
    to: q.get("to") ? new Date(q.get("to")! + "T23:59:59Z") : undefined,
    fuel: (q.get("fuel") as FuelCode) || undefined,
    usage: (q.get("usage") as "personnel") || undefined,
    driverUserId: q.get("driverUserId") ?? undefined,
  };
  const stamp = new Date().toISOString().slice(0, 10);
  if (q.get("format") === "pdf") {
    const pdf = await exportPdf(db, ctx, filters, "Export des pleins");
    return new Response(new Uint8Array(pdf), { headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="kivmo-pleins-${stamp}.pdf"` } });
  }
  const csv = await exportCsv(db, ctx, filters);
  return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="kivmo-pleins-${stamp}.csv"` } });
});
