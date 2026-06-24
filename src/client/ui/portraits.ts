/**
 * src/client/ui/portraits.ts — maps a generated NPC name to its PixelLab
 * portrait. The procedural generator's NAMES pool (src/server/case/procedural.ts)
 * uses these exact names, so every NPC resolves to a real cast portrait; any
 * unknown name falls back deterministically so the UI never renders blank.
 *
 * Art: "Cold Lovecraftian Noir", 1920s speakeasy "The Drowned Lily", 7 deadly
 * sins cast. Sprites are 240×320, transparent (PixelLab + flood-fill cutout).
 */
import lolaMarsh from "../assets/portraits/lola-marsh.png";
import donVittorio from "../assets/portraits/don-vittorio.png";
import frankieConti from "../assets/portraits/frankie-conti.png";
import silGreco from "../assets/portraits/sil-greco.png";
import royHalloran from "../assets/portraits/roy-halloran.png";
import nellCarraway from "../assets/portraits/nell-carraway.png";
import harlan from "../assets/portraits/harlan.png";
import mrAsh from "../assets/portraits/mr-ash.png";
import augieDoyle from "../assets/portraits/augie-doyle.png";
import oldCobb from "../assets/portraits/old-cobb.png";
import birdie from "../assets/portraits/birdie.png";
import marcoVictim from "../assets/portraits/marco-victim.png";

/** Exact name → portrait. Names mirror procedural.ts NAMES + the victim. */
const BY_NAME: Record<string, string> = {
  "Lola Marsh": lolaMarsh,
  "Don Vittorio": donVittorio,
  "Frankie Conti": frankieConti,
  "Sil Greco": silGreco,
  "Det. Halloran": royHalloran,
  "Nell Carraway": nellCarraway,
  Harlan: harlan,
  "Mr. Ash": mrAsh,
  "Augie Doyle": augieDoyle,
  "Old Cobb": oldCobb,
  Birdie: birdie,
  'Marco "the Ledger" Bellandi': marcoVictim,
};

const ALL = [
  lolaMarsh, donVittorio, frankieConti, silGreco, royHalloran, nellCarraway,
  harlan, mrAsh, augieDoyle, oldCobb, birdie, marcoVictim,
];

/** The character's portrait URL, or a deterministic fallback for unknown names. */
export function portraitFor(name: string): string {
  const exact = BY_NAME[name];
  if (exact) return exact;
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return ALL[Math.abs(h) % ALL.length]!;
}
