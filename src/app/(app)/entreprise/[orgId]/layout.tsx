import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { requireSession } from "@/server/session";
import { membershipOf } from "@/server/authz";
import { ROLE_LABELS } from "@/server/services/organizations";
import { OrgTabs } from "@/components/org-tabs";

export default async function OrgLayout({ children, params }: { children: React.ReactNode; params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  if (!/^[0-9a-f-]{36}$/.test(orgId)) notFound();
  const { ctx } = await requireSession();
  const db = getDb();
  const m = await membershipOf(db, ctx, orgId);
  if (!m) notFound();
  const [org] = await db.select().from(schema.organizations).where(eq(schema.organizations.id, orgId));
  const admin = ["owner", "fleet_admin"].includes(m.role);
  const tabs = [
    { href: `/entreprise/${orgId}`, label: "Tableau de bord" },
    { href: `/entreprise/${orgId}/vehicules`, label: "Véhicules" },
    ...(m.role !== "driver" && m.role !== "accountant" ? [{ href: `/entreprise/${orgId}/validations`, label: "Validations" }] : []),
    ...(admin || m.role === "manager" ? [{ href: `/entreprise/${orgId}/membres`, label: "Membres" }] : []),
    ...(admin || m.role === "accountant" ? [{ href: `/entreprise/${orgId}/periodes`, label: "Périodes" }] : []),
  ];
  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-muted">{ROLE_LABELS[m.role]}{org.isDemo ? " · organisation de démonstration" : ""}</p>
        <h1 className="text-2xl font-bold">{org.name}</h1>
      </div>
      <OrgTabs tabs={tabs} />
      {children}
    </div>
  );
}
