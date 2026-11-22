"use client";

import { useState } from "react";
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

export type ScanState = { status: "idle" | "reading" | "done" | "error"; message?: string };

/** Envoie une ou plusieurs photos au lecteur et renvoie les valeurs proposées. */
export async function scanPhotos<T>(target: "fillup" | "vehicle" | "maintenance", photos: Record<string, File>): Promise<{ ok: true; result: T } | { ok: false; message: string }> {
  const fd = new FormData();
  fd.set("target", target);
  for (const [kind, file] of Object.entries(photos)) {
    const small = await shrinkPhoto(file);
    if (small === file && !["image/jpeg", "image/png", "image/webp"].includes(file.type)) return { ok: false, message: UNSUPPORTED_PHOTO_MESSAGE };
    fd.set(kind, small, `${kind}.jpg`);
  }
  try {
    // La lecture prend en général quelques secondes ; au-delà de 50 s, on abandonne proprement.
    const res = await fetch("/api/scan", { method: "POST", body: fd, signal: AbortSignal.timeout(50_000) });
    const body = await res.json().catch(() => null);
    if (res.status === 413) return { ok: false, message: "Photo trop lourde. Réessayez, ou complétez à la main." };
    if (res.status === 504) return { ok: false, message: "La lecture a pris trop de temps. Réessayez avec une photo plus nette, ou complétez à la main." };
    if (!res.ok) return { ok: false, message: body?.error?.message ?? "Lecture impossible." };
    return { ok: true, result: body.result as T };
  } catch (e) {
    if (e instanceof DOMException && e.name === "TimeoutError") return { ok: false, message: "La lecture a pris trop de temps. Réessayez avec une photo plus nette, ou complétez à la main." };
    return { ok: false, message: "Pas de réseau : la lecture des photos demande une connexion. Complétez à la main." };
  }
}

/** Gros bouton « prendre une photo » avec aperçu et état de lecture. */
export function PhotoButton({ label, hint, onPhoto, state, preview }: { label: string; hint?: string; onPhoto: (f: File) => void; state?: ScanState; preview?: string | null }) {
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const shown = preview ?? localPreview;
  return (
    <label className={cx("tap flex cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed p-3 text-sm", state?.status === "done" ? "border-green bg-green-soft" : state?.status === "error" ? "border-warn" : "border-line")}>
      {shown ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={shown} alt="" className="h-14 w-14 shrink-0 rounded-lg object-cover" />
      ) : (
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-surface-2"><IconCamera width={24} /></span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{label}</span>
        <span className="block text-muted" role="status">
          {state?.status === "reading" ? "Lecture en cours…" : state?.message ?? hint}
        </span>
      </span>
      <input
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          setLocalPreview((old) => {
            if (old) URL.revokeObjectURL(old);
            return URL.createObjectURL(f);
          });
          onPhoto(f);
        }}
      />
    </label>
  );
}
