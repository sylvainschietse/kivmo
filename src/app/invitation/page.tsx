import Link from "next/link";
import { getSession } from "@/server/session";
import { Button, Card, ErrorFromQuery } from "@/components/ui";
import { acceptInvitationAction } from "@/app/actions/organizations";

export const metadata = { title: "Invitation" };

export default async function Invitation({ searchParams }: { searchParams: Promise<{ token?: string; erreur?: string }> }) {
  const q = await searchParams;
  const s = await getSession();
  const next = `/invitation?token=${encodeURIComponent(q.token ?? "")}`;
  return (
    <main id="contenu" className="mx-auto max-w-md space-y-4 p-4 pt-12">
      <h1 className="text-2xl font-bold">Invitation KIVMO</h1>
      <ErrorFromQuery error={q.erreur} />
      <Card>
        {!q.token ? (
          <p>Lien d&apos;invitation incomplet.</p>
        ) : !s ? (
          <>
            <p className="text-sm">Connectez-vous avec l&apos;adresse e-mail invitée pour rejoindre l&apos;organisation.</p>
            <Link href={`/connexion?next=${encodeURIComponent(next)}`} className="tap mt-3 inline-flex items-center rounded-xl bg-green px-4 font-semibold text-green-ink">Se connecter</Link>
          </>
        ) : (
          <form action={acceptInvitationAction} className="space-y-3">
            <input type="hidden" name="token" value={q.token} />
            <p className="text-sm">Connecté en tant que <strong>{s.user.email}</strong>. L&apos;invitation doit correspondre à cette adresse.</p>
            <Button type="submit">Rejoindre l&apos;organisation</Button>
          </form>
        )}
      </Card>
    </main>
  );
}
