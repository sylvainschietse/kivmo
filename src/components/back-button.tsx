"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

const KEY = "kivmo-pages-vues";

function pagesSeen() {
  try {
    return Number(sessionStorage.getItem(KEY) ?? 0);
  } catch {
    return 0;
  }
}

/** Compte les pages vues dans KIVMO pendant la session, pour savoir si « Retour » peut revenir en arrière. */
export function NavTracker() {
  const pathname = usePathname();
  useEffect(() => {
    try {
      sessionStorage.setItem(KEY, String(pagesSeen() + 1));
    } catch {
      /* stockage indisponible : « Retour » mènera à la page parente */
    }
  }, [pathname]);
  return null;
}

/** Retour à la page précédente de KIVMO ; à défaut (lien ouvert directement), vers la page parente. */
export function BackButton({ fallback, label = "Retour" }: { fallback: string; label?: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => (pagesSeen() > 1 && window.history.length > 1 ? router.back() : router.push(fallback))}
      className="tap -ml-2 mb-1 inline-flex items-center gap-1 rounded-xl px-2 text-sm font-semibold text-green"
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
      {label}
    </button>
  );
}
