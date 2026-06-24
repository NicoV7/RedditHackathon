/**
 * src/client/ui/theme.ts — "Cold Lovecraftian Noir" design tokens.
 * Cold abyssal speakeasy: slate-charcoal rooms, pale cold key-light, bone-ash UI,
 * a desaturated witch-green atmosphere. Crimson is RESERVED for the one signature
 * (the red string + lie-tell). The key light is COLD (moonlight/gaslight-wrong).
 *
 * Token names are kept stable (room/amber/paper/ink/paperDim) so the whole app
 * recolors at once; `amber` is now a COLD pale key-light, not warm.
 */
export const noir = {
  room: "#16242C", // cold slate room
  slate: "#0E1A20", // darker panel
  abyss: "#04080B", // deepest cold black
  amber: "#BFD2CA", // accent / cold key-light (was warm amber)
  paper: "#CBD2CC", // bone-ash UI text
  paperDim: "#8A958E", // muted secondary text
  crimson: "#D4322A", // THE signature — red string + lie-tell ONLY
  ink: "#070B0F", // deep shadow
  green: "#4E7A63", // desaturated witch-green atmosphere
} as const;

export const font =
  "'Iowan Old Style', 'Palatino Linotype', Palatino, 'Times New Roman', serif";

export type CSS = Record<string, React.CSSProperties>;
