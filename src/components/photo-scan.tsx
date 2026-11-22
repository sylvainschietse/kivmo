"use client";

import { useRef, useState } from "react";
import { IconCamera } from "@/components/icons";
import { cx } from "@/components/ui";

/** Réduit une photo de téléphone (souvent 4 à 8 Mo) en JPEG léger, suffisant pour la lecture. */
export async function shrinkPhoto(file: File, maxSide = 1600, quality = 0.85): Promise<Blob> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b ?? file), "image/jpeg", quality));
}

export const UNSUPPORTED_PHOTO_MESSAGE = "Format de photo non pris en charge (par exemple HEIC d'iPhone). Dans les réglages de l'appareil photo, choisissez « Le plus compatible » (JPEG), ou complétez à la main.";

export async function photoToDataUrl(file: File, maxSide: number, quality = 0.8) {
  const blob = await shrinkPhoto(file, maxSide, quality);
  return new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/** Annulation par l'utilisateur ou au bout du délai (repli pour les WebView sans AbortSignal.any). */
function withTimeout(signal: AbortSignal | undefined, ms: number) {
  const timeout = AbortSignal.timeout(ms);
  if (!signal) return timeout;
  if (typeof AbortSignal.any === "function") return AbortSignal.any([signal, timeout]);
  return signal;
}

export type ScanState = { status: "idle" | "reading" | "done" | "error"; message?: string };

/** Envoie une ou plusieurs photos au lecteur et renvoie les valeurs proposées. */
export async function scanPhotos<T>(
  target: "fillup" | "vehicle" | "maintenance",
  photos: Record<string, File>,
  signal?: AbortSignal,
): Promise<{ ok: true; result: T } | { ok: false; message: string; aborted?: boolean }> {
  const fd = new FormData();
  fd.set("target", target);
  for (const [kind, file] of Object.entries(photos)) {
    const small = await shrinkPhoto(file);
    if (small === file && !["image/jpeg", "image/png", "image/webp"].includes(file.type)) return { ok: false, message: UNSUPPORTED_PHOTO_MESSAGE };
    fd.set(kind, small, `${kind}.jpg`);
  }
  try {
    // La lecture prend en général quelques secondes ; au-delà de 50 s, on abandonne proprement.
    const res = await fetch("/api/scan", { method: "POST", body: fd, signal: withTimeout(signal, 50_000) });
    const body = await res.json().catch(() => null);
    if (res.status === 413) return { ok: false, message: "Photo trop lourde. Réessayez, ou complétez à la main." };
    if (res.status === 504) return { ok: false, message: "La lecture a pris trop de temps. Réessayez avec une photo plus nette, ou complétez à la main." };
    if (!res.ok) return { ok: false, message: body?.error?.message ?? "Lecture impossible." };
    return { ok: true, result: body.result as T };
  } catch (e) {
    if (signal?.aborted) return { ok: false, aborted: true, message: "" };
    if (e instanceof DOMException && e.name === "TimeoutError") return { ok: false, message: "La lecture a pris trop de temps. Réessayez avec une photo plus nette, ou complétez à la main." };
    return { ok: false, message: "Pas de réseau : la lecture des photos demande une connexion. Complétez à la main." };
  }
}

/**
 * Carte photo : « Prendre une photo » (appareil photo) ou « Galerie » (photo déjà prise),
 * avec aperçu, état de lecture et « Annuler » pour reprendre la main si la lecture traîne.
 * onPhoto reçoit un signal d'annulation à transmettre à scanPhotos.
 */
export function PhotoButton({ label, hint, onPhoto, state, preview }: { label: string; hint?: string; onPhoto: (f: File, signal: AbortSignal) => void; state?: ScanState; preview?: string | null }) {
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const shown = preview ?? localPreview;
  const reading = state?.status === "reading";

  function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return; // appareil photo fermé ou choix annulé : rien ne change
    controller.current?.abort();
    controller.current = new AbortController();
    setLocalPreview((old) => {
      if (old) URL.revokeObjectURL(old);
      return URL.createObjectURL(f);
    });
    onPhoto(f, controller.current.signal);
  }

  function cancel() {
    controller.current?.abort();
    controller.current = null;
    setLocalPreview((old) => {
      if (old) URL.revokeObjectURL(old);
      return null;
    });
  }

  const btn = "tap inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-lg px-3 text-sm font-semibold";
  return (
    <div className={cx("flex flex-col gap-2 rounded-xl border-2 border-dashed p-3 text-sm", state?.status === "done" ? "border-green bg-green-soft" : state?.status === "error" ? "border-warn" : "border-line")}>
      <div className="flex items-center gap-3">
        {shown ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={shown} alt="" className="h-14 w-14 shrink-0 rounded-lg object-cover" />
        ) : (
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-surface-2"><IconCamera width={24} /></span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">{label}</span>
          <span className="block text-muted" role="status">{reading ? "Lecture en cours…" : state?.message ?? hint}</span>
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {reading ? (
          <button type="button" onClick={cancel} className={cx(btn, "bg-surface-2 text-loss")}>Annuler</button>
        ) : (
          <>
            <label className={cx(btn, "bg-green text-white")}>
              <IconCamera width={16} /> {shown ? "Reprendre" : "Prendre une photo"}
              <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={pick} />
            </label>
            <label className={cx(btn, "bg-surface-2")}>
              Galerie
              <input type="file" accept="image/*" className="sr-only" onChange={pick} />
            </label>
          </>
        )}
      </div>
    </div>
  );
}
