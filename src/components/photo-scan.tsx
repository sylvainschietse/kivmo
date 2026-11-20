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
export async function scanPhotos<T>(target: "fillup" | "vehicle", photos: Record<string, File>): Promise<{ ok: true; result: T } | { ok: false; message: string }> {
  const fd = new FormData();
  fd.set("target", target);
  for (const [kind, file] of Object.entries(photos)) fd.set(kind, await shrinkPhoto(file), `${kind}.jpg`);
  try {
    const res = await fetch("/api/scan", { method: "POST", body: fd });
    const body = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, message: body?.error?.message ?? "Lecture impossible." };
    return { ok: true, result: body.result as T };
  } catch {
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
