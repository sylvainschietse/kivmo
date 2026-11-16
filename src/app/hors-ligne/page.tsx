import Link from "next/link";
export const metadata = { title: "Hors ligne" };
export default function HorsLigne() {
  return (
    <main id="contenu" className="mx-auto max-w-md px-4 py-16 text-center">
      <h1 className="text-2xl font-bold">Vous êtes hors ligne</h1>
      <p className="mt-2 text-muted">Les pages déjà consultées restent accessibles. Vous pouvez saisir un plein : il sera placé dans une file visible et envoyé seulement quand vous le déciderez.</p>
      <Link href="/pleins/nouveau" className="tap mt-6 inline-flex items-center rounded-xl bg-green px-4 py-2 font-semibold text-green-ink">Saisir un plein hors ligne</Link>
    </main>
  );
}
