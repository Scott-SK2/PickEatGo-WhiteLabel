/**
 * /manifest.webmanifest — généré depuis la marque de l'instance (édition Marque Blanche).
 * Mode plateforme : manifest PickEatGo historique. Mode mono-restaurant : nom, nom court,
 * icônes (192, 512, maskable), description et raccourcis « Commander » / « Mes commandes ».
 */
import { fetchBranding, brandMetadata, THEME_COLOR, BACKGROUND_COLOR } from "../lib/brand";

export const revalidate = 60;

export default async function manifest() {
  const b = await fetchBranding();
  const meta = brandMetadata(b);
  const icon192 = meta.icons.icon192, icon512 = meta.icons.icon512;
  const maskable = b.single && b.brand.icon_maskable_url ? b.brand.icon_maskable_url : "/icons/icon-maskable-512.png";
  const shortcuts = b.single
    ? [
        { name: "Commander", url: "/#menu", icons: [{ src: icon192, sizes: "192x192" }] },
        { name: "Mes commandes", url: "/#history", icons: [{ src: icon192, sizes: "192x192" }] },
      ]
    : [
        { name: "Dashboard restaurateur", url: "/dashboard", icons: [{ src: icon192, sizes: "192x192" }] },
        { name: "Commander", url: "/", icons: [{ src: icon192, sizes: "192x192" }] },
      ];
  return {
    id: "/",
    name: meta.applicationName,
    short_name: meta.appTitle,
    description: meta.description,
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: BACKGROUND_COLOR,
    theme_color: THEME_COLOR,
    lang: "fr",
    icons: [
      { src: icon192, sizes: "192x192", type: "image/png" },
      { src: icon512, sizes: "512x512", type: "image/png" },
      { src: maskable, sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts,
  };
}
