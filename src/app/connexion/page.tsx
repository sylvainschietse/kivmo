import Link from "next/link";
import { passwordLoginAction, passwordSignUpAction, requestLinkAction, startDemoAction } from "../actions/auth";
import { Button, Card, ErrorFromQuery, Field, Input, Notice } from "@/components/ui";
import { magicLinkAvailable, PASSWORD_MIN } from "@/server/auth";
import { env } from "@/server/env";

export const metadata = { title: "Connexion" };

type Q = { erreur?: string; envoye?: string; email?: string; dev?: string; expiree?: string; next?: string; mode?: string };

export default async function Connexion({ searchParams }: { searchParams: Promise<Q> }) {
  const q = await searchParams;
  const creation = q.mode === "creation";
  const next = q.next ?? "/accueil";
  const withNext = (mode?: string) => {
    const p = new URLSearchParams();
    if (mode) p.set("mode", mode);
    if (q.next) p.set("next", q.next);
    const s = p.toString();
    return s ? `/connexion?${s}` : "/connexion";
  };
  const linkAvailable = magicLinkAvailable();
  // Le lien de développement n'est affiché que s'il pointe vers la page de vérification de ce site.
  const devLink = q.dev && linkAvailable && q.dev.startsWith(`${env.appUrl}/connexion/verifier?`) ? q.dev : null;

  return (
    <main id="contenu" className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-8">
      <Link href="/" className="mb-6 flex items-center gap-2 text-xl font-black">
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-lime text-lime-ink">K</span> KIVMO
      </Link>
      <Card>
        <h1 className="text-xl font-bold">{creation ? "Créer mon compte" : "Se connecter"}</h1>
        <div className="mt-4 space-y-3">
          {q.expiree && <Notice tone="warn" title="Connexion expirée">Votre session a expiré. Reconnectez-vous pour continuer.</Notice>}
          <ErrorFromQuery error={q.erreur} />
          {q.envoye ? (
            <Notice tone="gain" title="Lien envoyé">
              Si l&apos;adresse {q.email} est valide, un lien de connexion vient d&apos;être envoyé.
              {devLink && (
                <span className="mt-2 block">
                  Mode développement (aucun email réel) : <a className="font-semibold underline" href={devLink}>ouvrir le lien de connexion</a>
                </span>
              )}
            </Notice>
          ) : null}

          {creation ? (
            <form action={passwordSignUpAction} className="space-y-3">
              <input type="hidden" name="next" value={next} />
              <Field label="Adresse email" htmlFor="email">
                <Input id="email" name="email" type="email" autoComplete="email" required defaultValue={q.email} inputMode="email" />
              </Field>
              <Field label="Mot de passe" htmlFor="password" hint={`Au moins ${PASSWORD_MIN} caractères.`}>
                <Input id="password" name="password" type="password" autoComplete="new-password" required minLength={PASSWORD_MIN} maxLength={200} />
              </Field>
              <Field label="Confirmer le mot de passe" htmlFor="confirm">
                <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required minLength={PASSWORD_MIN} maxLength={200} />
              </Field>
              <Button type="submit" className="w-full">Créer mon compte</Button>
              <p className="text-center text-sm">
                Déjà un compte ? <Link href={withNext()} className="font-semibold text-green underline">Se connecter</Link>
              </p>
            </form>
          ) : (
            <form action={passwordLoginAction} className="space-y-3">
              <input type="hidden" name="next" value={next} />
              <Field label="Adresse email" htmlFor="email">
                <Input id="email" name="email" type="email" autoComplete="email" required defaultValue={q.email} inputMode="email" />
              </Field>
              <Field label="Mot de passe" htmlFor="password">
                <Input id="password" name="password" type="password" autoComplete="current-password" required maxLength={200} />
              </Field>
              <Button type="submit" className="w-full">Se connecter</Button>
              <p className="text-center text-sm">
                Pas encore de compte ? <Link href={withNext("creation")} className="font-semibold text-green underline">Créer mon compte</Link>
              </p>
            </form>
          )}
        </div>
      </Card>

      {linkAvailable && (
        <Card className="mt-4">
          <h2 className="text-base font-semibold">Sans mot de passe</h2>
          <p className="mt-1 text-sm text-muted">Recevez un lien de connexion à usage unique, valable 15 minutes.</p>
          <form action={requestLinkAction} className="mt-3 space-y-3">
            <input type="hidden" name="next" value={next} />
            <Field label="Email pour le lien" htmlFor="email-lien">
              <Input id="email-lien" name="email" type="email" autoComplete="email" required inputMode="email" />
            </Field>
            <Button type="submit" variant="secondary" className="w-full">Recevoir mon lien</Button>
          </form>
        </Card>
      )}

      <form action={startDemoAction} className="mt-4">
        <Button variant="secondary" type="submit" className="w-full">Essayer sans compte (démo fictive)</Button>
      </form>
      {!linkAvailable && (
        <p className="mt-4 text-center text-xs text-muted">Mot de passe oublié : la réinitialisation par email sera disponible une fois l&apos;envoi d&apos;emails branché.</p>
      )}
    </main>
  );
}
