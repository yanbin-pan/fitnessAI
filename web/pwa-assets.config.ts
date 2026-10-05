import { defineConfig, minimal2023Preset } from "@vite-pwa/assets-generator/config";

// logo.svg is full-bleed: its own background fills the tile, and the zabaione ball with its soft shadow
// reaches about 196 of 512 from the centre, inside the maskable safe zone (radius 204.8). The presets'
// default padding would shrink the mark to under half the tile, so the home-screen icons take none.
export default defineConfig({
  preset: {
    ...minimal2023Preset,
    maskable: { ...minimal2023Preset.maskable, padding: 0, resizeOptions: { background: "#E4E9F0" } },
    apple: { ...minimal2023Preset.apple, padding: 0, resizeOptions: { background: "#E4E9F0" } },
  },
  images: ["public/logo.svg"],
});
