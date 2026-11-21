import { requireSession } from "@/server/session";
import { getDb } from "@/db/client";
import { myOrganizations } from "@/server/services/organizations";
import { unreadCount } from "@/server/services/notifications";
import { BottomNav, Sidebar } from "@/components/nav";
import { OfflineQueueBar } from "@/components/offline-queue";
import { NavTracker } from "@/components/back-button";
import { logoutAction } from "../actions/auth";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { ctx, user } = await requireSession();
  const db = getDb();
  const orgs = await myOrganizations(db, ctx);
  const unread = await unreadCount(db, ctx.userId);
  return (
    <div className="flex min-h-dvh">
      <Sidebar
        orgs={orgs.filter((o) => o.org.kind !== "partenaire").map((o) => ({ id: o.org.id, name: o.org.name }))}
        partnerOrgs={orgs.filter((o) => o.org.kind === "partenaire").map((o) => ({ id: o.org.id, name: o.org.name }))}
        isAdmin={user.isPlatformAdmin}
        unread={unread}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        {user.isDemo && (
          <div role="status" className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-2 bg-lime px-4 py-2 text-sm font-semibold text-lime-ink">
            <span>Mode démonstration : toutes les données sont fictives et isolées. Aucun virement réel possible.</span>
            <form action={logoutAction}>
              <button className="tap rounded-lg px-2 underline">Quitter la démo</button>
            </form>
          </div>
        )}
        <NavTracker />
        <OfflineQueueBar />
        <main id="contenu" className="mx-auto w-full max-w-6xl flex-1 px-4 pb-28 pt-5 sm:px-6 lg:pb-10">
          {children}
        </main>
      </div>
      <BottomNav />
    </div>
  );
}
