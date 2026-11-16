import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ServiceWorker } from "@/components/sw-register";

export const metadata: Metadata = {
  title: { default: "KIVMO", template: "%s · KIVMO" },
  description: "Roulez. Économisez. Réalisez vos projets. Suivi des pleins, économies mesurées, stations et projets d'épargne.",
  applicationName: "KIVMO",
  appleWebApp: { capable: true, title: "KIVMO", statusBarStyle: "default" },
  icons: { icon: "/icon.svg", apple: "/icon-192.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F5F7FA" },
    { media: "(prefers-color-scheme: dark)", color: "#0f161d" },
  ],
};

const themeScript = `try{var t=localStorage.getItem('kivmo-theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-dvh">
        <a href="#contenu" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded-lg focus:bg-surface focus:p-3">
          Aller au contenu
        </a>
        {children}
        <ServiceWorker />
      </body>
    </html>
  );
}
