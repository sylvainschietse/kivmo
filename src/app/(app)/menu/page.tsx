import Link from "next/link";
import { getDb } from "@/db/client";
import { requireSession } from "@/server/session";
import { myOrganizations } from "@/server/services/organizations";
import { Button, Card, PageHeader } from "@/components/ui";
import { IconBell, IconBuilding, IconCalc, IconCar, IconChart, IconHandshake, IconHistory, IconRoute, IconShield, IconTarget, IconUser } from "@/components/icons";
import { logoutAction } from "@/app/actions/auth";

export const metadata = { title: "Menu" };

/** Toutes les rubriques, pour les petits écrans où le menu latéral n'est pas affiché. */
export default async function Menu() {
  const { ctx, user } = await requireSession();
  const orgs = await myOrganizations(getDb(), ctx);
  const companies = orgs.filter((o) => o.org.kind !== "partenaire");
  const partners = orgs.filter((o) => o.org.kind === "partenaire");
  const links: { href: string; label: string; Icon: React.ComponentType }[] = [
    { href: "/profil", label: "Profil et paramètres", Icon: IconUser },
    { href: "/notifications", label: "Notifications", Icon: IconBell },
    { href: "/historique", label: "Historique des pleins", Icon: IconHistory },
    { href: "/analyses", label: "Analyses", Icon: IconChart },
    { href: "/trajets", label: "Trajets et détours", Icon: IconRoute },
    { href: "/simulations", label: "Simulations", Icon: IconCalc },
    { href: "/projets", label: "Projets et épargne", Icon: IconTarget },
    { href: "/garage", label: "Garage", Icon: IconCar },
    { href: "/partenaires", label: "Partenaires", Icon: IconHandshake },
    ...companies.map((o) => ({ href: `/entreprise/${o.org.id}`, label: o.org.name, Icon: IconBuilding })),
    { href: "/entreprise", label: companies.length ? "Gérer les organisations" : "Créer une organisation", Icon: IconBuilding },
    ...partners.map((o) => ({ href: `/espace-pro/${o.org.id}`, label: `Espace pro : ${o.org.name}`, Icon: IconHandshake })),
    ...(user.isPlatformAdmin ? [{ href: "/admin", label: "Administration KIVMO", Icon: IconShield }] : []),
  ];
  return (
    <div className="mx-auto max-w-lg space-y-4">
      <PageHeader title="Menu" subtitle={ctx.isDemo ? "Compte de démonstration" : user.email} />
      <Card>
        <nav aria-label="Toutes les rubriques">
          <ul className="divide-y divide-line">
            {links.map(({ href, label, Icon }) => (
              <li key={href}>
                <Link href={href} className="tap flex min-h-12 items-center gap-3 py-2 text-sm font-medium">
                  <Icon />
                  <span className="flex-1">{label}</span>
                  <span aria-hidden="true" className="text-muted">›</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </Card>
      <form action={logoutAction}>
        <Button type="submit" variant="secondary" className="w-full">Se déconnecter</Button>
      </form>
    </div>
  );
}
