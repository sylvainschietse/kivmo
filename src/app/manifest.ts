import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "KIVMO — Roulez. Économisez. Réalisez vos projets.",
    short_name: "KIVMO",
    description: "Suivi des pleins, économies mesurées, stations et projets d'épargne.",
    start_url: "/accueil",
    display: "standalone",
    background_color: "#F5F7FA",
    theme_color: "#087F6B",
    lang: "fr",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
    ],
    shortcuts: [{ name: "Ajouter un plein", url: "/pleins/nouveau" }, { name: "Stations", url: "/stations" }],
  };
}
