import Link from "next/link";
import { getDb } from "@/db/client";
import { requireSession } from "@/server/session";
import { listNotifications, NOTIFICATION_KINDS } from "@/server/services/notifications";
import { formatDateTime } from "@/lib/format";
import { Badge, Button, EmptyState, PageHeader } from "@/components/ui";
import { markAllReadAction } from "@/app/actions/profile";

export const metadata = { title: "Notifications" };

export default async function Notifications() {
  const { ctx } = await requireSession();
  const list = await listNotifications(getDb(), ctx.userId);
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader title="Notifications" action={list.some((n) => !n.readAt) ? <form action={markAllReadAction}><Button type="submit" variant="secondary">Tout marquer comme lu</Button></form> : null} />
      {list.length === 0 ? <EmptyState title="Aucune notification">Réglez ce qui vous intéresse dans <Link className="underline" href="/profil">Profil</Link>.</EmptyState> : (
        <ul className="space-y-2">
          {list.map((n) => (
            <li key={n.id} className={`rounded-2xl border p-3 ${n.readAt ? "border-line bg-surface" : "border-green bg-green-soft"}`}>
              <div className="flex flex-wrap items-center justify-between gap-2"><strong>{n.title}</strong><span className="text-xs text-muted">{formatDateTime(n.createdAt)}</span></div>
              <p className="text-sm">{n.body}</p>
              <p className="mt-1 flex gap-2"><Badge>{NOTIFICATION_KINDS[n.kind] ?? n.kind}</Badge>{n.link && n.link.startsWith("/") && <Link className="text-sm font-semibold text-green underline" href={n.link}>Ouvrir</Link>}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
