import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db/client";
import { requireSession } from "@/server/session";
import { formatMoney } from "@/lib/format";
import { Button, Card, EmptyState, ErrorFromQuery, Notice, PageHeader } from "@/components/ui";
import { sandboxAuthorizeAction } from "@/app/actions/savings";

export const metadata = { title: "Banque de démonstration" };

export default async function BacASable({ searchParams }: { searchParams: Promise<{ ref?: string; erreur?: string }> }) {
  const q = await searchParams;
  const { ctx } = await requireSession();
  const db = getDb();
  const [order] = q.ref ? await db.select().from(schema.paymentOrders).where(eq(schema.paymentOrders.providerOrderRef, q.ref)) : [];
  if (!order || order.ownerUserId !== ctx.userId) return <EmptyState title="Ordre introuvable">Ce lien d&apos;autorisation n&apos;est pas valide.</EmptyState>;
  return (
    <div className="mx-auto max-w-md space-y-4">
      <PageHeader title="Banque de démonstration" subtitle="Simulation de l'écran d'autorisation forte de votre banque" />
      <ErrorFromQuery error={q.erreur} />
      <Notice tone="warn" title="Fictif">Cet écran simule une banque. Aucun virement réel n&apos;est émis.</Notice>
      <Card>
        <p className="text-sm text-muted">Virement à autoriser</p>
        <p className="num text-3xl font-bold">{formatMoney(order.amount, order.currency)}</p>
        <p className="mt-1 text-sm">Statut actuel : {order.state === "to_authorize" ? "en attente de votre autorisation" : order.state}</p>
        {order.state === "to_authorize" && (
          <div className="mt-4 flex flex-wrap gap-2">
            <form action={sandboxAuthorizeAction}><input type="hidden" name="ref" value={q.ref} /><input type="hidden" name="decision" value="accept" /><Button type="submit">Autoriser</Button></form>
            <form action={sandboxAuthorizeAction}><input type="hidden" name="ref" value={q.ref} /><input type="hidden" name="decision" value="refuse" /><Button type="submit" variant="danger">Refuser</Button></form>
          </div>
        )}
      </Card>
    </div>
  );
}
