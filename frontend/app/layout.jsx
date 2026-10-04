// app/layout.jsx — Layout racine : marque de l'instance (édition Marque Blanche), AuthProvider, PWA
import { AuthProvider } from "../lib/AuthContext";
import { BrandProvider } from "../lib/BrandContext";
import { fetchBranding, brandMetadata, THEME_COLOR } from "../lib/brand";
import PwaRegister from "./PwaRegister";
import InputGuard from "./InputGuard";

/**
 * Métadonnées lues depuis GET /api/v1/branding/ (revalidées toutes les 60 s) : titre d'onglet,
 * description, icônes, image de partage et nom d'installation suivent la marque du restaurant
 * en mode mono-restaurant ; en mode plateforme, ce sont celles de PickEatGo.
 */
export async function generateMetadata() {
  const b = await fetchBranding();
  const m = brandMetadata(b);
  return {
    title: m.title,
    description: m.description,
    manifest: "/manifest.webmanifest",
    icons: {
      icon: [{ url: m.icons.icon192, sizes: "192x192", type: "image/png" }, { url: m.icons.icon512, sizes: "512x512", type: "image/png" }],
      apple: m.icons.apple,
    },
    appleWebApp: { capable: true, statusBarStyle: "default", title: m.appTitle },
    applicationName: m.applicationName,
    openGraph: {
      title: m.title, description: m.description, siteName: m.applicationName, type: "website", locale: "fr_BE",
      ...(m.image ? { images: [{ url: m.image, width: 1200, height: 630 }] } : {}),
    },
    twitter: { card: m.image ? "summary_large_image" : "summary", title: m.title, description: m.description, ...(m.image ? { images: [m.image] } : {}) },
  };
}

// Viewport mobile : largeur écran, pas de zoom initial, encoches iPhone (safe-area) prises en charge
export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: THEME_COLOR,          // identité visuelle PickEatGo conservée dans cette version
};

export default async function RootLayout({ children }) {
  const branding = await fetchBranding();
  return (
    <html lang="fr">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Sora:wght@400;600;700;800&family=Instrument+Sans:wght@400;500;600;700&family=DM+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />
      </head>
      {/* Pas de style inline ici : il écraserait le `margin:0 auto` qui centre l'app sur desktop */}
      <body>
        <BrandProvider initial={branding}>
          <AuthProvider>
            <PwaRegister />
            <InputGuard />
            {children}
          </AuthProvider>
        </BrandProvider>
      </body>
    </html>
  );
}
