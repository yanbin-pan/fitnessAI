import { defineConfig, minimal2023Preset } from "@vite-pwa/assets-generator/config";

export default defineConfig({
  preset: {
    ...minimal2023Preset,
    maskable: { ...minimal2023Preset.maskable, resizeOptions: { background: "#E4E9F0" } },
    apple: { ...minimal2023Preset.apple, resizeOptions: { background: "#E4E9F0" } },
  },
  images: ["public/logo.svg"],
});
