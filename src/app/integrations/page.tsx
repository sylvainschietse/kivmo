import Link from "next/link";
import { integrations } from "@/integrations/registry";
import { IntegrationPill } from "@/components/ui";

export const metadata = { title: "État des services" };
export const dynamic = "force-dynamic";

export default function Integrations() {
  const list = integrations();
  return (
    <main id="contenu" className="mx-auto max-w-3xl space-y-4 p-4 pt-10">
      <Link href="/" className="text-sm font-semibold text-green underline">← KIVMO</Link>
      <h1 className="text-2xl font-bold">État des services</h1>
      <p className="text-sm text-muted">Ce qui est réellement connecté, ce qui fonctionne en bac à sable et ce qui reste à connecter. Aucun service « à connecter » n&apos;est simulé dans un compte réel.</p>
      <ul className="space-y-2">
        {list.map((i) => (
          <li key={i.key} className="rounded-2xl border border-line bg-surface p-4">
            <div className="flex flex-wrap items-center justify-between gap-2"><strong>{i.label}</strong><IntegrationPill status={i.status} /></div>
            <p className="mt-1 text-sm text-muted">{i.detail}</p>
          </li>
        ))}
      </ul>
    </main>
  );
}
