/**
 * src/client/ui/theme.ts — Lamplight Noir design tokens (locked palette).
 * Warm theatrical-parlor: teal-charcoal rooms, lamp-amber, aged-paper UI.
 * Crimson is RESERVED for the red string + lie-tell accents only.
 */
export const noir = {
  room: "#1B2A2E", // teal-charcoal
  amber: "#E8B86D", // lamp-amber
  paper: "#E9DEC9", // aged-paper UI
  crimson: "#D4322A", // red string + lie-tell ONLY
  ink: "#14211F", // deep shadow
  paperDim: "#C9BCA0", // muted aged-paper for secondary text
} as const;

export const font =
  "'Iowan Old Style', 'Palatino Linotype', Palatino, 'Times New Roman', serif";

export type CSS = Record<string, React.CSSProperties>;
