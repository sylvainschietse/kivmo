"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

/**
 * File locale des pleins saisis hors ligne (§17). Chaque entrée a un identifiant stable,
 * utilisé comme clé d'idempotence : un renvoi ne crée jamais de doublon. Rien n'est envoyé
 * automatiquement au retour du réseau : l'utilisateur déclenche la synchronisation.
 * Conservation locale limitée à 30 jours ; données en clair dans le stockage du navigateur
 * de l'appareil (chiffrement applicatif à envisager si l'appareil est partagé).
 */
export interface QueuedFillup {
  clientId: string;
  createdAt: string;
  payload: Record<string, unknown>;
  status: "en_attente" | "erreur" | "conflit";
  message?: string;
}

const KEY = "kivmo-offline-fillups";
const MAX_AGE_DAYS = 30;

export function readQueue(): QueuedFillup[] {
  try {
    const all = JSON.parse(localStorage.getItem(KEY) ?? "[]") as QueuedFillup[];
    const cutoff = Date.now() - MAX_AGE_DAYS * 86_400_000;
    return all.filter((q) => new Date(q.createdAt).getTime() > cutoff);
  } catch {
    return [];
  }
}

export function writeQueue(q: QueuedFillup[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(q));
    window.dispatchEvent(new Event("kivmo-queue"));
  } catch {
    /* stockage indisponible */
  }
}

export function enqueueFillup(payload: Record<string, unknown>, clientId: string) {
  const q = readQueue().filter((x) => x.clientId !== clientId);
  q.push({ clientId, createdAt: new Date().toISOString(), payload, status: "en_attente" });
  writeQueue(q);
}

export async function sendFillup(payload: Record<string, unknown>, clientId: string) {
  const res = await fetch("/api/fillups", {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": clientId },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

export function OfflineQueueBar() {
  const [queue, setQueue] = useState<QueuedFillup[]>([]);
  const [online, setOnline] = useState(true);
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(() => setQueue(readQueue()), []);

  useEffect(() => {
    // La file vit dans le stockage local : lue après l'hydratation.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
    setOnline(navigator.onLine);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    window.addEventListener("kivmo-queue", refresh);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
      window.removeEventListener("kivmo-queue", refresh);
    };
  }, [refresh]);

  async function sync() {
    setBusy(true);
    const next: QueuedFillup[] = [];
    for (const item of readQueue()) {
      try {
        const r = await sendFillup({ ...item.payload, source: "offline_sync" }, item.clientId);
        if (r.ok && (r.body.status === "created" || r.body.status === "existing")) continue;
        if (r.body.status === "needs_confirmation" || r.body.status === "amount_mismatch") {
          next.push({ ...item, status: "conflit", message: "À vérifier : ouvrez la saisie pour confirmer." });
        } else next.push({ ...item, status: "erreur", message: r.body?.error?.message ?? `Erreur ${r.status}` });
      } catch {
        next.push({ ...item, status: "erreur", message: "Réseau indisponible." });
      }
    }
    writeQueue(next);
    setBusy(false);
    if (next.length === 0) window.location.reload();
  }

  if (online && queue.length === 0) return null;
  return (
    <div role="status" className="border-b border-line bg-info-soft px-4 py-2 text-sm">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2">
        <span>
          {!online && <strong>Hors ligne. </strong>}
          {queue.length > 0 ? `${queue.length} plein(s) en attente de synchronisation sur cet appareil.` : "Les données affichées peuvent dater de votre dernière connexion."}
          {queue.some((q) => q.status !== "en_attente") && " Certains demandent une vérification."}
        </span>
        {queue.length > 0 && (
          <span className="flex gap-2">
            <Link href="/pleins/nouveau?file=1" className="tap inline-flex items-center rounded-lg px-3 font-semibold underline">Voir la file</Link>
            <button onClick={sync} disabled={!online || busy} className="tap rounded-lg bg-info px-3 font-semibold text-white disabled:opacity-50">
              {busy ? "Synchronisation…" : "Synchroniser maintenant"}
            </button>
          </span>
        )}
      </div>
    </div>
  );
}
