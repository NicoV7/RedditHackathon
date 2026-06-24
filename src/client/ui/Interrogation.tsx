/**
 * src/client/ui/Interrogation.tsx — the dialogue stage (Cold Lovecraftian Noir).
 *
 * Disco-Elysium two-panel layout: the suspect's PixelLab PORTRAIT on the LEFT
 * (the face is the focus + where a future lie-tell will live), the conversation
 * on the RIGHT — running transcript, an in-character "…thinking" state, collected
 * clues, question chips (asked chips gray out), and a bounded free-text input
 * (≤140 chars, moderated server-side — the in-app content-rule guardrail).
 *
 * Presentational + local input state only; the fetch + FSM dispatch live in
 * App.tsx (passed in as onAsk). On a narrow viewport the portrait reflows to a
 * cropped top band over the dialogue.
 */
import { useMemo, useState } from "react";
import type { ClientNpcView, RevealedClue } from "../../shared/api.js";
import { noir, font } from "./theme.js";
import { portraitFor } from "./portraits.js";

const MAX_INPUT = 140; // bounded free-text (no unbounded input — compliance)

const DEFAULT_CHIPS = [
  "Where were you last night?",
  "Did you know the victim?",
  "Who do you suspect?",
  "What did you see?",
  "Do you have an alibi?",
] as const;

export interface InterrogationLine {
  speaker: "you" | "npc";
  text: string;
}

export interface InterrogationProps {
  npc: ClientNpcView;
  transcript: InterrogationLine[];
  clues: RevealedClue[];
  freshClueIds: string[];
  askedChips: string[];
  thinking: boolean;
  onAsk: (message: string) => void;
  onBack: () => void;
}

export function Interrogation(props: InterrogationProps): React.JSX.Element {
  const { npc, transcript, clues, freshClueIds, askedChips, thinking } = props;
  const [draft, setDraft] = useState("");

  const chips = useMemo(() => DEFAULT_CHIPS, []);
  const fresh = useMemo(() => new Set(freshClueIds), [freshClueIds]);
  const portrait = useMemo(() => portraitFor(npc.name), [npc.name]);

  function ask(message: string): void {
    const m = message.trim();
    if (!m || thinking) return;
    props.onAsk(m);
    setDraft("");
  }

  return (
    <div style={styles.screen}>
      {/* LEFT — portrait stage */}
      <aside style={styles.portrait}>
        <img src={portrait} alt={npc.name} style={styles.sprite} />
        <div style={styles.fog} />
        <button type="button" style={styles.back} onClick={props.onBack}>
          ‹ leave
        </button>
        <div style={styles.plate}>
          <div style={styles.npcName}>{npc.name}</div>
          <div style={styles.npcVoice}>{npc.blurb}</div>
        </div>
      </aside>

      {/* RIGHT — dialogue */}
      <section style={styles.talk}>
        <div style={styles.transcript}>
          {transcript.length === 0 && (
            <div style={styles.opening}>
              <em>{npc.name} regards you, waiting. ({npc.voice})</em>
            </div>
          )}
          {transcript.map((line, i) => (
            <div
              key={i}
              style={line.speaker === "you" ? styles.lineYou : styles.lineNpc}
            >
              {line.text}
            </div>
          ))}
          {thinking && (
            <div style={{ ...styles.lineNpc, ...styles.thinking }}>
              <em>{npc.name} considers the question…</em>
            </div>
          )}
        </div>

        {clues.length > 0 && (
          <div style={styles.clueRail} aria-label="Clues collected">
            {clues.map((c) => (
              <span
                key={c.id}
                style={{
                  ...styles.clueChip,
                  ...(fresh.has(c.id) ? styles.clueChipFresh : null),
                }}
              >
                {c.text}
              </span>
            ))}
          </div>
        )}

        <div style={styles.chips}>
          {chips.map((c) => {
            const used = askedChips.includes(c);
            return (
              <button
                key={c}
                type="button"
                disabled={used || thinking}
                style={{ ...styles.chip, ...(used ? styles.chipUsed : null) }}
                onClick={() => ask(c)}
              >
                {c}
              </button>
            );
          })}
        </div>

        <form
          style={styles.inputRow}
          onSubmit={(e) => {
            e.preventDefault();
            ask(draft);
          }}
        >
          <input
            style={styles.input}
            value={draft}
            maxLength={MAX_INPUT}
            placeholder="Press them in your own words…"
            onChange={(e) => setDraft(e.target.value.slice(0, MAX_INPUT))}
            disabled={thinking}
          />
          <button
            type="submit"
            style={styles.send}
            disabled={thinking || draft.trim().length === 0}
          >
            Ask
          </button>
        </form>
      </section>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  screen: {
    height: "100%",
    display: "flex",
    background:
      "radial-gradient(140% 120% at 50% -10%, #15343a 0%, #0a2026 30%, #051419 60%, #04080b 100%)",
    color: noir.paper,
    fontFamily: font,
    overflow: "hidden",
  },
  // ── portrait ──
  portrait: {
    width: "42%",
    maxWidth: 460,
    position: "relative",
    overflow: "hidden",
    borderRight: `1px solid #14282c`,
    background:
      "radial-gradient(60% 56% at 50% 40%, rgba(120,170,160,.16), transparent 62%)",
    flex: "0 0 auto",
  },
  sprite: {
    position: "absolute",
    left: "50%",
    bottom: 0,
    transform: "translateX(-50%)",
    height: "99%",
    imageRendering: "pixelated",
    filter: "drop-shadow(0 6px 18px rgba(0,0,0,.55))",
  },
  fog: {
    position: "absolute",
    inset: 0,
    pointerEvents: "none",
    background:
      "linear-gradient(180deg, transparent 52%, rgba(5,18,22,.5) 80%, rgba(4,14,18,.92))",
  },
  back: {
    position: "absolute",
    top: 12,
    left: 12,
    background: "rgba(4,8,10,.5)",
    color: noir.amber,
    border: "none",
    borderRadius: 8,
    padding: "6px 10px",
    fontSize: 14,
    cursor: "pointer",
    fontFamily: font,
    zIndex: 3,
  },
  plate: { position: "absolute", left: 0, right: 0, bottom: 0, padding: "14px 16px", zIndex: 2 },
  npcName: { fontSize: 23, fontWeight: 700, color: "#e3efe8" },
  npcVoice: { fontSize: 12.5, color: noir.paperDim, fontStyle: "italic", marginTop: 3, lineHeight: 1.35 },
  // ── dialogue ──
  talk: { flex: 1, display: "flex", flexDirection: "column", padding: "20px 24px 16px", minWidth: 0 },
  transcript: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    gap: 10,
    overflowY: "auto",
    minHeight: 0,
    justifyContent: "flex-end",
  },
  opening: { color: noir.paperDim, fontSize: 15, lineHeight: 1.5 },
  lineYou: { alignSelf: "flex-end", maxWidth: "88%", color: "#9fb1ad", fontSize: 15, lineHeight: 1.5 },
  lineNpc: {
    alignSelf: "flex-start",
    maxWidth: "92%",
    color: "#eef4ee",
    fontSize: 18,
    lineHeight: 1.55,
  },
  thinking: { opacity: 0.7 },
  clueRail: { display: "flex", flexWrap: "wrap", gap: 6, margin: "12px 0 4px" },
  clueChip: {
    fontSize: 12,
    color: noir.paper,
    background: "rgba(120,170,160,.08)",
    border: `1px solid #2c4a44`,
    borderRadius: 6,
    padding: "5px 9px",
  },
  clueChipFresh: { borderColor: noir.crimson, boxShadow: `0 0 0 1px ${noir.crimson}55` },
  chips: { display: "flex", flexWrap: "wrap", gap: 8, margin: "14px 0 10px" },
  chip: {
    fontFamily: font,
    fontSize: 12.5,
    color: "#cfe0d8",
    background: "transparent",
    border: `1px solid #2c4a44`,
    borderRadius: 999,
    padding: "8px 13px",
    cursor: "pointer",
    minHeight: 38,
  },
  chipUsed: { color: "#5d7068", borderColor: "#1c302c", cursor: "default" },
  inputRow: { display: "flex", gap: 8 },
  input: {
    flex: 1,
    background: "rgba(3,12,14,.7)",
    border: `1px solid #234039`,
    color: noir.paper,
    fontFamily: font,
    fontSize: 15,
    padding: "12px 14px",
    borderRadius: 8,
    minWidth: 0,
  },
  send: {
    background: noir.amber,
    color: "#08181a",
    border: "none",
    borderRadius: 8,
    padding: "0 18px",
    fontSize: 15,
    fontWeight: 700,
    cursor: "pointer",
    fontFamily: font,
    minHeight: 46,
  },
};
