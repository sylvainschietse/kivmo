"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "./ui";
import { IconBuilding, IconCalc, IconCar, IconChart, IconHandshake, IconHistory, IconHome, IconPlus, IconPump, IconRoute, IconShield, IconTarget, IconUser, IconBell, IconMenu } from "./icons";

const mobile = [
  { href: "/accueil", label: "Accueil", Icon: IconHome },
  { href: "/stations", label: "Stations", Icon: IconPump },
  { href: "/pleins/nouveau", label: "Ajouter", Icon: IconPlus, primary: true },
  { href: "/projets", label: "Projets", Icon: IconTarget },
  { href: "/garage", label: "Garage", Icon: IconCar },
];

export function BottomNav() {
  const path = usePathname();
  return (
    <nav aria-label="Navigation principale" className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
      <ul className="mx-auto grid max-w-lg grid-cols-5">
        {mobile.map(({ href, label, Icon, primary }) => {
          const active = path === href || (href !== "/accueil" && path.startsWith(href));
          return (
            <li key={href} className="flex justify-center">
              <Link href={href} aria-current={active ? "page" : undefined} className={cx("tap flex flex-col items-center justify-center gap-0.5 px-2 py-1.5 text-[11px] font-medium", active ? "text-green" : "text-muted")}>
                {primary ? (
                  <span className="-mt-5 flex h-12 w-12 items-center justify-center rounded-full bg-lime text-lime-ink shadow-md ring-4 ring-surface">
                    <Icon />
                  </span>
                ) : (
                  <Icon />
                )}
                <span>{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function Sidebar({ orgs, isAdmin, partnerOrgs, unread }: { orgs: { id: string; name: string }[]; partnerOrgs: { id: string; name: string }[]; isAdmin: boolean; unread: number }) {
  const path = usePathname();
  const item = (href: string, label: string, Icon: React.ComponentType, badge?: number) => {
    const active = path === href || (href !== "/accueil" && path.startsWith(href));
    return (
      <li key={href}>
        <Link href={href} aria-current={active ? "page" : undefined} className={cx("tap flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium", active ? "bg-green-soft text-green" : "text-ink hover:bg-surface-2")}>
          <Icon />
          <span className="flex-1">{label}</span>
          {badge ? <span className="rounded-full bg-loss px-2 text-xs font-bold text-white" aria-label={`${badge} non lues`}>{badge}</span> : null}
        </Link>
      </li>
    );
  };
  return (
    <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col gap-4 overflow-y-auto border-r border-line bg-surface p-4 lg:flex">
      <Link href="/accueil" className="flex items-center gap-2 px-2 py-1 text-xl font-black tracking-tight">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-lime text-lime-ink">K</span> KIVMO
      </Link>
      <Link href="/pleins/nouveau" className="tap flex items-center justify-center gap-2 rounded-xl bg-lime px-4 py-2.5 text-sm font-bold text-lime-ink">
        <IconPlus /> Ajouter un plein
      </Link>
      <nav aria-label="Navigation principale">
        <ul className="flex flex-col gap-1">
          {item("/accueil", "Accueil", IconHome)}
          {item("/stations", "Stations", IconPump)}
          {item("/trajets", "Trajets et détours", IconRoute)}
          {item("/historique", "Historique", IconHistory)}
          {item("/analyses", "Analyses", IconChart)}
          {item("/simulations", "Simulations", IconCalc)}
          {item("/projets", "Projets et épargne", IconTarget)}
          {item("/garage", "Garage", IconCar)}
          {item("/partenaires", "Partenaires", IconHandshake)}
          {item("/notifications", "Notifications", IconBell, unread)}
          {item("/profil", "Profil et paramètres", IconUser)}
        </ul>
      </nav>
      <div>
        <p className="px-3 text-xs font-semibold uppercase tracking-wide text-muted">Espace entreprise</p>
        <ul className="mt-1 flex flex-col gap-1">
          {orgs.map((o) => item(`/entreprise/${o.id}`, o.name, IconBuilding))}
          {item("/entreprise", orgs.length ? "Gérer les organisations" : "Créer une organisation", IconBuilding)}
        </ul>
      </div>
      {partnerOrgs.length > 0 && (
        <div>
          <p className="px-3 text-xs font-semibold uppercase tracking-wide text-muted">Espace professionnel</p>
          <ul className="mt-1 flex flex-col gap-1">{partnerOrgs.map((o) => item(`/espace-pro/${o.id}`, o.name, IconHandshake))}</ul>
        </div>
      )}
      {isAdmin && <ul>{item("/admin", "Administration KIVMO", IconShield)}</ul>}
    </aside>
  );
}

/** En-tête des petits écrans (téléphone, appli Android) : notifications et menu complet. */
export function MobileHeader({ unread }: { unread: number }) {
  return (
    <header className="flex items-center justify-between border-b border-line bg-surface px-4 py-2 lg:hidden">
      <Link href="/accueil" className="flex items-center gap-2 text-lg font-black tracking-tight">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-lime text-lime-ink">K</span> KIVMO
      </Link>
      <div className="flex items-center gap-1">
        <Link href="/notifications" className="tap relative flex h-11 w-11 items-center justify-center rounded-xl text-ink" aria-label={unread ? `Notifications, ${unread} non lues` : "Notifications"}>
          <IconBell />
          {unread ? <span className="absolute right-1.5 top-1.5 min-w-5 rounded-full bg-loss px-1 text-center text-[11px] font-bold text-white" aria-hidden="true">{unread}</span> : null}
        </Link>
        <Link href="/menu" className="tap flex h-11 w-11 items-center justify-center rounded-xl text-ink" aria-label="Menu : profil, déconnexion et autres rubriques">
          <IconMenu />
        </Link>
      </div>
    </header>
  );
}
