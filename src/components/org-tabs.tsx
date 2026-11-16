"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "./ui";

export function OrgTabs({ tabs }: { tabs: { href: string; label: string }[] }) {
  const path = usePathname();
  return (
    <nav aria-label="Sections de l'organisation" className="-mx-4 overflow-x-auto px-4">
      <ul className="flex gap-1 border-b border-line">
        {tabs.map((t) => {
          const active = path === t.href;
          return (
            <li key={t.href}>
              <Link href={t.href} aria-current={active ? "page" : undefined} className={cx("tap inline-flex items-center whitespace-nowrap border-b-2 px-3 text-sm font-semibold", active ? "border-green text-green" : "border-transparent text-muted")}>{t.label}</Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
