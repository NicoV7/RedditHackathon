/**
 * src/client/ui/Resolution.tsx — win/lose reveal as a "Parlor Wrapped" summary
 * card (Part 1.4 / 1.5 retention spine). A recap/cliffhanger opener, crowd stats
 * (killerRightPct, your clue count), the detective XP/level + play/solve streaks,
 * and a spoiler-safe shareable verdict line.
 *
 * The reveal is server-authoritative: the verdict + crowd come from AccuseResponse;
 * the detective sheet (level/streaks) from the persistent DetectiveState. The share
 * line + cliffhanger are spoiler-safe — they never name the killer.
 */
import { useState } from "react";
import type { AccuseResponse, DetectiveState } from "../../shared/api.js";
import { noir, font } from "./theme.js";
import { levelOf, recapOpener, cliffhanger } from "./detective.js";

export interface ResolutionProps {
  result: AccuseResponse;
  dailySeed: string;
  /** the persistent detective sheet (level + play/solve streaks); null until loaded. */
  detective?: DetectiveState | null;
  onReplay?: () => void;
}

/** Spoiler-safe: solved/failed + score + streak, never the killer's name. */
export function shareLine(r: AccuseResponse, dailySeed: string): string {
  const mark = r.solved ? "🔎 Solved" : "🕯️ Stumped";
  const rank = r.rank != null ? ` · rank #${r.rank}` : "";
  return `Parlor ${dailySeed} — ${mark} in ${r.summary.yourClueCount} clues · streak ${r.streak.count}${rank}. No spoilers. Your turn.`;
}

export function Resolution(props: ResolutionProps): React.JSX.Element {
  const { result: r, dailySeed, detective } = props;
  const [copied, setCopied] = useState(false);
  const share = shareLine(r, dailySeed);
  const lvl = levelOf(detective ?? null);
  const opener = recapOpener(r.solved, detective?.solveStreak ?? 0);

  async function copyShare(): Promise<void> {
    try {
      await navigator.clipboard.writeText(share);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div style={styles.screen}>
      <div style={styles.card}>
        {/* recap opener (Part 1.4) — spoiler-safe, never names the killer */}
        <div style={styles.opener}>{opener}</div>

        <div style={{ ...styles.verdict, color: r.solved ? noir.amber : noir.crimson }}>
          {r.solved ? "Case Closed" : "The Killer Walks"}
        </div>
        <div style={styles.reveal}>
          It was <strong style={styles.killer}>{r.summary.killerName}</strong>.
        </div>

        <div style={styles.stats}>
          <Stat label="Your clues" value={String(r.summary.yourClueCount)} />
          <Stat label="Score" value={String(r.score)} />
          <Stat
            label="Streak"
            value={`${r.streak.count}${r.streak.freeze > 0 ? ` ❄${r.streak.freeze}` : ""}`}
          />
          {r.rank != null && <Stat label="Rank" value={`#${r.rank}`} />}
        </div>

        {/* Detective progression (Part 1.3) — level + XP bar + play/solve streaks. */}
        {detective && (
          <section style={styles.detective} aria-label="Your detective sheet">
            <div style={styles.detRow}>
              <span style={styles.detLevel}>Detective · Lv {lvl.level}</span>
              <span style={styles.detXp}>
                {lvl.intoLevel}/{lvl.span} XP
              </span>
            </div>
            <div style={styles.xpBarWrap}>
              <div style={{ ...styles.xpBar, width: `${Math.round(lvl.progress * 100)}%` }} />
            </div>
            <div style={styles.streaks}>
              <span style={styles.streakChip} title="Consecutive days played (the habit)">
                🔥 Play {detective.playStreak}
              </span>
              <span style={styles.streakChip} title="Consecutive solves (the skill)">
                🎯 Solve {detective.solveStreak}
              </span>
            </div>
          </section>
        )}

        <div style={styles.crowd}>
          <div style={styles.crowdTitle}>The crowd</div>
          <div style={styles.crowdBarWrap}>
            <div
              style={{ ...styles.crowdBar, width: `${clampPct(r.summary.crowd.killerRightPct)}%` }}
            />
          </div>
          <div style={styles.crowdLabel}>
            {clampPct(r.summary.crowd.killerRightPct)}% of {r.summary.crowd.total} detectives
            named the right killer.
          </div>
        </div>

        {/* cliffhanger teaser (Part 1.4) — spoiler-safe, teases tomorrow's case */}
        <div style={styles.cliff}>{cliffhanger()}</div>

        <div style={styles.shareBox} aria-label="Shareable verdict">
          {share}
        </div>
        <button type="button" style={styles.share} onClick={copyShare}>
          {copied ? "Copied — go brag" : "Copy spoiler-safe verdict"}
        </button>
        {props.onReplay && (
          <button type="button" style={styles.replay} onClick={props.onReplay}>
            Back to the parlor
          </button>
        )}
      </div>
    </div>
  );
}

function Stat(props: { label: string; value: string }): React.JSX.Element {
  return (
    <div style={styles.stat}>
      <div style={styles.statValue}>{props.value}</div>
      <div style={styles.statLabel}>{props.label}</div>
    </div>
  );
}

function clampPct(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
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
    maxWidth: 440,
    background: noir.paper,
    color: noir.ink,
    borderRadius: 14,
    padding: 24,
    boxShadow: "0 18px 50px rgba(0,0,0,0.55)",
    border: `1px solid ${noir.amber}`,
    textAlign: "center",
  },
  opener: {
    fontSize: 14.5,
    fontStyle: "italic",
    lineHeight: 1.5,
    color: "#5a5040",
    marginBottom: 16,
  },
  verdict: { fontSize: 14, letterSpacing: 3, fontWeight: 700, marginBottom: 6 },
  reveal: { fontSize: 24, marginBottom: 20 },
  killer: { color: noir.crimson },
  stats: { display: "flex", justifyContent: "center", gap: 18, marginBottom: 22, flexWrap: "wrap" },
  stat: { minWidth: 64 },
  statValue: { fontSize: 26, fontWeight: 700, color: noir.ink },
  statLabel: { fontSize: 11, letterSpacing: 1, color: "#6a5f4a", textTransform: "uppercase" },
  // ── detective progression ──
  detective: {
    textAlign: "left",
    marginBottom: 22,
    padding: "12px 14px",
    background: noir.room,
    borderRadius: 10,
    color: noir.paper,
  },
  detRow: { display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 },
  detLevel: { fontSize: 15, fontWeight: 700, color: noir.amber },
  detXp: { fontSize: 12, color: noir.paperDim },
  xpBarWrap: { height: 8, background: noir.ink, borderRadius: 999, overflow: "hidden" },
  xpBar: { height: "100%", background: noir.amber, borderRadius: 999 },
  streaks: { display: "flex", gap: 10, marginTop: 12 },
  streakChip: {
    fontSize: 12.5,
    color: noir.paper,
    background: "rgba(191,210,202,0.1)",
    border: `1px solid ${noir.amber}55`,
    borderRadius: 999,
    padding: "5px 11px",
  },
  crowd: { textAlign: "left", marginBottom: 22 },
  crowdTitle: { fontSize: 12, letterSpacing: 1, color: "#6a5f4a", marginBottom: 6 },
  crowdBarWrap: { height: 10, background: noir.room, borderRadius: 999, overflow: "hidden" },
  crowdBar: { height: "100%", background: noir.amber, borderRadius: 999 },
  crowdLabel: { marginTop: 8, fontSize: 13, color: "#3a3327" },
  cliff: {
    fontSize: 13.5,
    fontStyle: "italic",
    lineHeight: 1.5,
    color: "#7a3a35",
    background: `${noir.crimson}10`,
    borderLeft: `2px solid ${noir.crimson}`,
    borderRadius: "0 8px 8px 0",
    padding: "10px 12px",
    textAlign: "left",
    marginBottom: 16,
  },
  shareBox: {
    fontSize: 13,
    lineHeight: 1.4,
    background: noir.room,
    color: noir.paper,
    borderRadius: 10,
    padding: "10px 12px",
    marginBottom: 12,
    textAlign: "left",
  },
  share: {
    width: "100%",
    padding: "14px 18px",
    fontSize: 16,
    fontWeight: 700,
    fontFamily: font,
    color: noir.ink,
    background: noir.amber,
    border: "none",
    borderRadius: 10,
    cursor: "pointer",
    minHeight: 52,
  },
  replay: {
    width: "100%",
    marginTop: 10,
    padding: "12px 18px",
    fontSize: 14,
    fontFamily: font,
    color: noir.ink,
    background: "transparent",
    border: `1px solid ${noir.ink}`,
    borderRadius: 10,
    cursor: "pointer",
  },
};
