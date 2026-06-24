/**
 * src/client/assets/assets.d.ts — ambient module declarations for the asset
 * formats the Parlor build-time pipeline (Part 4.4) imports as Vite URL strings.
 *
 * `*.png` is already declared in src/client/images.d.ts (owned elsewhere); this
 * file adds ONLY the audio + atlas-data formats the asset manifest references so
 * imports resolve under `tsc --noEmit`. Vite turns each import into a served URL
 * string at build time — no runtime cost. Keep these in sync with the file kinds
 * the manifest in ../phaser/assets.ts enumerates.
 */
declare module "*.mp3" {
  const src: string;
  export default src;
}
declare module "*.ogg" {
  const src: string;
  export default src;
}
declare module "*.m4a" {
  const src: string;
  export default src;
}
declare module "*.webp" {
  const src: string;
  export default src;
}
