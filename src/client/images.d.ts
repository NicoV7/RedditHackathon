// Vite resolves image imports to served URL strings.
declare module "*.png" {
  const src: string;
  export default src;
}
