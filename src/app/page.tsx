import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/server/session";
import { startDemoAction } from "./actions/auth";
import { Button, ErrorFromQuery } from "@/components/ui";

export default async function Landing({ searchParams }: { searchParams: Promise<{ erreur?: string }> }) {
  const s = await getSession();
  if (s && !s.user.isDemo) redirect("/accueil");
  const { erreur } = await searchParams;
  return (
    <main id="contenu" className="mx-auto flex min-h-dvh max-w-5xl flex-col px-4 py-6 sm:py-10">
      <header className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-xl font-black tracking-tight">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-lime text-lime-ink">K</span> KIVMO
        </span>
        <Link href="/connexion" className="tap inline-flex items-center rounded-xl px-3 text-sm font-semibold text-green">Se connecter</Link>
      </header>
      <ErrorFromQuery error={erreur} />
      <section className="mt-10 grid gap-8 md:grid-cols-2 md:items-center">
        <div>
          <p className="inline-flex rounded-full bg-lime px-3 py-1 text-xs font-bold text-lime-ink">Kilomètres · Itinéraires · Véhicules · Mobilité · Optimisation</p>
          <h1 className="mt-4 text-4xl font-black leading-tight tracking-tight sm:text-5xl">Roulez. Économisez. Réalisez vos projets.</h1>
          <p className="mt-4 text-lg text-muted">
            Suivez vos pleins, mesurez votre vraie consommation, comparez honnêtement à votre référence et transformez les économies observées en projets.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/connexion" className="tap inline-flex items-center justify-center rounded-xl bg-green px-5 py-3 font-semibold text-green-ink">Créer mon compte gratuit</Link>
            <form action={startDemoAction}>
              <Button variant="lime" type="submit" className="px-5 py-3">Découvrir en mode démo</Button>
            </form>
          </div>
          <p className="mt-3 text-xs text-muted">Le mode démo utilise des données fictives, isolées et clairement signalées. Rien n&apos;y est fusionné avec un compte réel.</p>
        </div>
        <ul className="grid gap-3 text-sm">
          {[
            ["Mesure plein à plein", "Consommation calculée entre deux pleins complets, jamais devinée. Résultats négatifs affichés tels quels."],
            ["Comparaison sur la même distance", "Votre coût réel face à votre ancien véhicule ou un scénario, avec la méthode affichée."],
            ["Stations et prix datés", "Chaque prix a une source et une date. Un prix affiché ne prouve pas la disponibilité."],
            ["Projets et épargne", "Économie calculée, montant affecté et virements réellement confirmés restent distincts."],
            ["Indépendants et flottes", "Véhicules, conducteurs, validations, budgets, clôtures et exports comptables."],
          ].map(([t, d]) => (
            <li key={t} className="rounded-2xl border border-line bg-surface p-4">
              <p className="font-semibold">{t}</p>
              <p className="mt-1 text-muted">{d}</p>
            </li>
          ))}
        </ul>
      </section>
      <footer className="mt-auto pt-10 text-xs text-muted">
        <Link href="/integrations" className="underline">État des services connectés</Link> · Accès particulier gratuit · Vos positions et historiques ne sont pas vendus.
      </footer>
    </main>
  );
}
