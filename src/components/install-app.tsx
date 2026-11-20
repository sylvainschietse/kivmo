"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui";

type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };
type Platform = "installed" | "ios" | "ios-other-browser" | "android" | "other";

const DISMISS_KEY = "kivmo-install-masque";

function detect(): Platform {
  const nav = window.navigator as Navigator & { standalone?: boolean };
  const ua = nav.userAgent;
  // L'APK Android (dossier mobile/) ajoute « KivmoAndroid » à l'agent utilisateur.
  if (window.matchMedia("(display-mode: standalone)").matches || nav.standalone || ua.includes("KivmoAndroid")) return "installed";
  const ios = /iPhone|iPad|iPod/.test(ua) || (ua.includes("Macintosh") && nav.maxTouchPoints > 1);
  if (ios) return /CriOS|FxiOS|EdgiOS/.test(ua) ? "ios-other-browser" : "ios";
  if (/Android/.test(ua)) return "android";
  return "other";
}

/** Aide à l'installation sur l'écran d'accueil. Le bouton n'apparaît que si le navigateur propose réellement l'installation. */
export function InstallApp({ dismissible = false }: { dismissible?: boolean }) {
  const [platform, setPlatform] = useState<Platform | null>(null);
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);
  const [hidden, setHidden] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    // Détection côté navigateur uniquement : le serveur ne connaît pas l'appareil.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPlatform(detect());
    if (dismissible) {
      try {
        if (localStorage.getItem(DISMISS_KEY) === "1") setHidden(true);
      } catch {
        /* stockage indisponible : on affiche l'aide */
      }
    }
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e as InstallPromptEvent);
    };
    const onInstalled = () => setDone(true);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, [dismissible]);

  if (!platform || hidden) return null;
  if (platform === "installed" || done) {
    return dismissible ? null : <p className="text-sm text-muted">KIVMO est installée sur cet appareil.</p>;
  }
  if (dismissible && platform === "other") return null;

  const dismiss = () => {
    setHidden(true);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* rien à faire */
    }
  };

  return (
    <div className={dismissible ? "space-y-2 rounded-2xl border border-line bg-surface p-4 text-sm shadow-sm" : "space-y-2 text-sm"} data-testid="installer-appli">
      <p className="font-semibold">Installer KIVMO sur votre téléphone</p>
      {prompt ? (
        <Button
          type="button"
          onClick={async () => {
            await prompt.prompt();
            const choice = await prompt.userChoice;
            setPrompt(null);
            if (choice.outcome === "accepted") setDone(true);
          }}
        >
          Installer l&apos;application
        </Button>
      ) : platform === "ios" ? (
        <ol className="list-decimal space-y-1 pl-5">
          <li>Touchez le bouton Partager (le carré avec une flèche vers le haut) en bas de Safari.</li>
          <li>Choisissez « Sur l&apos;écran d&apos;accueil ».</li>
          <li>Touchez « Ajouter » : l&apos;icône KIVMO apparaît avec vos autres applis.</li>
        </ol>
      ) : platform === "ios-other-browser" ? (
        <p>Sur iPhone, ouvrez cette page dans Safari, puis Partager, puis « Sur l&apos;écran d&apos;accueil ».</p>
      ) : platform === "android" ? (
        <ol className="list-decimal space-y-1 pl-5">
          <li>Touchez le menu ⋮ en haut à droite de Chrome.</li>
          <li>Choisissez « Installer l&apos;application » ou « Ajouter à l&apos;écran d&apos;accueil ».</li>
        </ol>
      ) : (
        <p>Ouvrez KIVMO sur votre téléphone pour l&apos;ajouter à l&apos;écran d&apos;accueil.</p>
      )}
      {dismissible && (
        <button type="button" onClick={dismiss} className="tap text-sm text-muted underline">
          Ne plus afficher
        </button>
      )}
    </div>
  );
}
