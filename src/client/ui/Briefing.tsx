/**
 * src/client/ui/Briefing.tsx — the feed-card-as-hook first screen.
 * One-line premise + suspect portrait placeholders + one fat CTA.
 * Mobile-first; the whole card is the hook that drops the player into the case.
 */
import type { ClientCaseView } from "../../shared/api.js";
import { noir, font } from "./theme.js";

export interface BriefingProps {
  view: ClientCaseView;
  onStart: () => void;
}

function premiseLine(view: ClientCaseView): string {
  const where = view.setting?.trim() || "the parlor";
  const who = view.victim?.trim() || "a guest";
  return `Last night at ${where}, ${who} was found dead. Someone here is lying.`;
}

export function Briefing({ view, onStart }: BriefingProps): React.JSX.Element {
  const suspects = view.npcs.filter((n) => view.suspectIds.includes(n.id));

  return (
    <div style={styles.screen}>
      <div style={styles.card}>
        <div style={styles.kicker}>PARLOR · TONIGHT'S CASE</div>
        <h1 style={styles.title}>{view.victim?.trim() || "A Death at the Parlor"}</h1>
        <p style={styles.premise}>{premiseLine(view)}</p>

        <div style={styles.portraitRow}>
          {suspects.map((n) => (
            <div key={n.id} style={styles.portrait} title={n.blurb}>
              <div style={styles.portraitFace} aria-hidden>
                {initials(n.name)}
              </div>
              <div style={styles.portraitName}>{n.name}</div>
            </div>
          ))}
        </div>

        <button type="button" style={styles.cta} onClick={onStart}>
          Start interrogating
        </button>
        <div style={styles.hint}>
          {suspects.length} suspects · drop into one first, the board unlocks after your first clue.
        </div>
      </div>
    </div>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

const styles: Record<string, React.CSSProperties> = {
  screen: {
    minHeight: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    background: noir.room,
    fontFamily: font,
  },
  card: {
    width: "100%",
    maxWidth: 480,
    background: noir.paper,
    color: noir.ink,
    borderRadius: 14,
    padding: 24,
    boxShadow: "0 18px 50px rgba(0,0,0,0.55)",
    border: `1px solid ${noir.amber}`,
  },
  kicker: {
    fontSize: 12,
    letterSpacing: 2,
    color: noir.crimson,
    fontWeight: 700,
    marginBottom: 8,
  },
  title: { margin: "0 0 10px", fontSize: 28, lineHeight: 1.15 },
  premise: { margin: "0 0 20px", fontSize: 17, lineHeight: 1.45, color: "#3a3327" },
  portraitRow: {
    display: "flex",
    gap: 10,
    overflowX: "auto",
    paddingBottom: 6,
    marginBottom: 22,
  },
  portrait: { flex: "0 0 auto", width: 72, textAlign: "center" },
  portraitFace: {
    width: 64,
    height: 64,
    borderRadius: "50%",
    margin: "0 auto 6px",
    background: noir.room,
    color: noir.amber,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 700,
    fontSize: 20,
    border: `2px solid ${noir.amber}`,
  },
  portraitName: {
    fontSize: 12,
    color: "#4a4234",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  cta: {
    display: "block",
    width: "100%",
    padding: "16px 20px",
    fontSize: 18,
    fontWeight: 700,
    fontFamily: font,
    color: noir.ink,
    background: noir.amber,
    border: "none",
    borderRadius: 10,
    cursor: "pointer",
    minHeight: 56,
  },
  hint: { marginTop: 12, fontSize: 13, textAlign: "center", color: "#6a5f4a" },
};
