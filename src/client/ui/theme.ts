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

/**
 * The six inner-voice Faculties (Part 1.2), with a display label + a single glyph
 * for the inner-voice rail. PURELY cosmetic metadata — the tell's faculty + line
 * are server-authored; this only decorates the interjection. Logic + Empathy are
 * SPINE; the rest are STRETCH but kept here so the rail renders any faculty a
 * server tell names without code changes.
 */
export const FACULTY_META: Record<
  string,
  { label: string; glyph: string }
> = {
  logic: { label: "Logic", glyph: "⟁" },
  empathy: { label: "Empathy", glyph: "♥" },
  drama: { label: "Drama", glyph: "✶" },
  perception: { label: "Perception", glyph: "◉" },
  authority: { label: "Authority", glyph: "❡" },
  encyclopedia: { label: "Encyclopedia", glyph: "❖" },
} as const;

/** Display metadata for a faculty id, with a safe fallback for unknown ids. */
export function facultyMeta(faculty: string): { label: string; glyph: string } {
  return FACULTY_META[faculty] ?? { label: faculty, glyph: "•" };
}
