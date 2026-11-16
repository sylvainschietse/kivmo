import Link from "next/link";
import { getDb } from "@/db/client";
import { requireSession } from "@/server/session";
import { myOrganizations, ROLE_LABELS } from "@/server/services/organizations";
import { Badge, Button, Card, ErrorFromQuery, Field, Input, OkFromQuery, PageHeader, Select } from "@/components/ui";
import { createOrganizationAction } from "@/app/actions/organizations";

export const metadata = { title: "Espace entreprise" };

export default async function Entreprise({ searchParams }: { searchParams: Promise<{ ok?: string; erreur?: string }> }) {
  const q = await searchParams;
  const { ctx } = await requireSession();
  const orgs = await myOrganizations(getDb(), ctx);
  return (
    <div className="space-y-4">
      <PageHeader title="Organisations" subtitle="Foyer, entreprise ou partenaire : les données de chaque organisation sont strictement séparées." />
      <OkFromQuery ok={q.ok} />
      <ErrorFromQuery error={q.erreur} />
      {orgs.length > 0 && (
        <ul className="grid gap-3 sm:grid-cols-2">
          {orgs.map(({ org, role }) => (
            <li key={org.id}>
              <Link href={org.kind === "partenaire" ? `/espace-pro/${org.id}` : `/entreprise/${org.id}`} className="block rounded-2xl border border-line bg-surface p-4 hover:border-green">
                <p className="font-semibold">{org.name}</p>
                <p className="mt-1 flex flex-wrap gap-1"><Badge tone="info">{org.kind === "partenaire" ? "Partenaire" : org.kind === "foyer" ? "Foyer" : "Entreprise"}</Badge><Badge>{ROLE_LABELS[role]}</Badge>{org.isDemo && <Badge tone="lime">Démo</Badge>}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Card title="Créer une organisation">
        <form action={createOrganizationAction} className="grid gap-3 sm:grid-cols-3">
          <Field label="Nom" htmlFor="name"><Input id="name" name="name" required maxLength={120} /></Field>
          <Field label="Type" htmlFor="kind"><Select id="kind" name="kind"><option value="entreprise">Entreprise / flotte</option><option value="foyer">Foyer</option><option value="partenaire">Professionnel partenaire (garage, installateur)</option></Select></Field>
          <div className="flex items-end"><Button type="submit">Créer</Button></div>
        </form>
        <p className="mt-2 text-xs text-muted">Vous en devenez propriétaire. Invitez ensuite gestionnaires, conducteurs et comptables.</p>
      </Card>
    </div>
  );
}
