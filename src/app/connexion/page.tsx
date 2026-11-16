import Link from "next/link";
import { requestLinkAction, startDemoAction } from "../actions/auth";
import { Button, Card, ErrorFromQuery, Field, Input, Notice } from "@/components/ui";

export const metadata = { title: "Connexion" };

export default async function Connexion({ searchParams }: { searchParams: Promise<{ erreur?: string; envoye?: string; email?: string; dev?: string; expiree?: string; next?: string }> }) {
  const q = await searchParams;
  return (
    <main id="contenu" className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-8">
      <Link href="/" className="mb-6 flex items-center gap-2 text-xl font-black">
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-lime text-lime-ink">K</span> KIVMO
      </Link>
      <Card>
        <h1 className="text-xl font-bold">Connexion ou création de compte</h1>
        <p className="mt-1 text-sm text-muted">Recevez un lien de connexion à usage unique, valable 15 minutes. Aucun mot de passe à retenir.</p>
        <div className="mt-4 space-y-3">
          {q.expiree && <Notice tone="warn" title="Connexion expirée">Votre session a expiré. Reconnectez-vous pour continuer.</Notice>}
          <ErrorFromQuery error={q.erreur} />
          {q.envoye ? (
            <Notice tone="gain" title="Lien envoyé">
              Si l&apos;adresse {q.email} est valide, un lien de connexion vient d&apos;être envoyé.
              {q.dev && (
                <span className="mt-2 block">
                  Mode développement (aucun email réel) : <a className="font-semibold underline" href={q.dev}>ouvrir le lien de connexion</a>
                </span>
              )}
            </Notice>
          ) : null}
          <form action={requestLinkAction} className="space-y-3">
            <input type="hidden" name="next" value={q.next ?? "/accueil"} />
            <Field label="Adresse email" htmlFor="email">
              <Input id="email" name="email" type="email" autoComplete="email" required defaultValue={q.email} inputMode="email" />
            </Field>
            <Button type="submit" className="w-full">Recevoir mon lien</Button>
          </form>
        </div>
      </Card>
      <form action={startDemoAction} className="mt-4">
        <Button variant="secondary" type="submit" className="w-full">Essayer sans compte (démo fictive)</Button>
      </form>
      <p className="mt-4 text-center text-xs text-muted">Connexion via un fournisseur d&apos;identité : à connecter selon le dispositif retenu.</p>
    </main>
  );
}
