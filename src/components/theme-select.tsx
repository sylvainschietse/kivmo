"use client";

/** Applique immédiatement le thème (et le mémorise sur l'appareil) ; le formulaire l'enregistre au profil. */
export function ThemeSelect({ value }: { value: string }) {
  const apply = (t: string) => {
    try {
      if (t === "light" || t === "dark") {
        localStorage.setItem("kivmo-theme", t);
        document.documentElement.dataset.theme = t;
      } else {
        localStorage.removeItem("kivmo-theme");
        delete document.documentElement.dataset.theme;
      }
    } catch {}
  };
  return (
    <select id="theme" name="theme" defaultValue={value} onChange={(e) => apply(e.target.value)} className="tap w-full rounded-xl border border-line bg-surface px-3">
      <option value="system">Celui de l&apos;appareil</option>
      <option value="light">Clair</option>
      <option value="dark">Sombre</option>
    </select>
  );
}
