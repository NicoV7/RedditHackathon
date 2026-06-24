/**
 * src/client/ui/Interrogation.tsx — the dialogue screen.
 * Question chips + bounded free-text → ≤2-sentence NPC replies. Revealed clues
 * animate into a "clue collected" list; asked chips gray out; an in-character
 * "…thinking" state shows during the await.
 *
 * This component is presentational + local input state only. The actual fetch
 * and FSM dispatch are owned by App.tsx (passed in as onAsk).
 */
import { useMemo, useState } from "react";
import type { ClientNpcView, RevealedClue } from "../../shared/api.js";
import { noir, font } from "./theme.js";

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
  /** transcript so far for this NPC */
  transcript: InterrogationLine[];
  /** clues revealed across the whole case (for the collected list) */
  clues: RevealedClue[];
  /** ids freshly revealed this dialogue, for the "collected" animation */
  freshClueIds: string[];
  /** chip prompts already asked this session (grayed out) */
  askedChips: string[];
  /** true while awaiting the server reply */
  thinking: boolean;
  onAsk: (message: string) => void;
  onBack: () => void;
}

export function Interrogation(props: InterrogationProps): React.JSX.Element {
  const { npc, transcript, clues, freshClueIds, askedChips, thinking } = props;
  const [draft, setDraft] = useState("");

  const chips = useMemo(() => DEFAULT_CHIPS, []);
  const fresh = useMemo(() => new Set(freshClueIds), [freshClueIds]);

  function ask(message: string): void {
    const m = message.trim();
    if (!m || thinking) return;
    props.onAsk(m);
    setDraft("");
  }

  return (
    <div style={styles.screen}>
      <header style={styles.header}>
        <button type="button" style={styles.back} onClick={props.onBack}>
          ‹ Back
        </button>
        <div style={styles.who}>
          <div style={styles.npcName}>{npc.name}</div>
          <div style={styles.npcVoice}>{npc.blurb}</div>
        </div>
      </header>

      <div style={styles.body}>
        <div style={styles.transcript}>
          {transcript.map((line, i) => (
            <div
              key={i}
              style={line.speaker === "you" ? styles.bubbleYou : styles.bubbleNpc}
            >
              {line.text}
            </div>
          ))}
          {thinking && (
            <div style={{ ...styles.bubbleNpc, ...styles.thinking }}>
              <em>{npc.name} considers the question…</em>
            </div>
          )}
        </div>

        <aside style={styles.clueRail} aria-label="Clues collected">
          <div style={styles.clueTitle}>Clues collected</div>
          {clues.length === 0 && (
            <div style={styles.clueEmpty}>No clues yet. Keep pressing.</div>
          )}
          <ul style={styles.clueList}>
            {clues.map((c) => (
              <li
                key={c.id}
                style={{
                  ...styles.clueItem,
                  ...(fresh.has(c.id) ? styles.clueItemFresh : null),
                }}
              >
                {c.text}
              </li>
            ))}
          </ul>
        </aside>
      </div>

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
          placeholder="Ask in your own words…"
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
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  screen: {
    height: "100%",
    display: "flex",
    flexDirection: "column",
    background: noir.room,
    color: noir.paper,
    fontFamily: font,
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "12px 16px",
    borderBottom: `1px solid ${noir.ink}`,
  },
  back: {
    background: "transparent",
    color: noir.amber,
    border: "none",
    fontSize: 16,
    cursor: "pointer",
    fontFamily: font,
  },
  who: { lineHeight: 1.2 },
  npcName: { fontSize: 18, fontWeight: 700, color: noir.amber },
  npcVoice: { fontSize: 12, color: noir.paperDim },
  body: { flex: 1, display: "flex", gap: 12, padding: 16, overflow: "hidden" },
  transcript: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    gap: 8,
    overflowY: "auto",
    minWidth: 0,
  },
  bubbleYou: {
    alignSelf: "flex-end",
    maxWidth: "85%",
    background: noir.amber,
    color: noir.ink,
    padding: "8px 12px",
    borderRadius: "12px 12px 2px 12px",
    fontSize: 15,
  },
  bubbleNpc: {
    alignSelf: "flex-start",
    maxWidth: "85%",
    background: noir.ink,
    color: noir.paper,
    padding: "8px 12px",
    borderRadius: "12px 12px 12px 2px",
    fontSize: 15,
  },
  thinking: { opacity: 0.7, fontStyle: "italic" },
  clueRail: {
    width: 168,
    flex: "0 0 auto",
    background: "rgba(233,222,201,0.06)",
    borderRadius: 10,
    padding: 10,
    overflowY: "auto",
  },
  clueTitle: { fontSize: 12, letterSpacing: 1, color: noir.amber, marginBottom: 8 },
  clueEmpty: { fontSize: 12, color: noir.paperDim },
  clueList: { listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 },
  clueItem: {
    fontSize: 12,
    lineHeight: 1.3,
    background: noir.paper,
    color: noir.ink,
    padding: "6px 8px",
    borderRadius: 6,
    borderLeft: `3px solid ${noir.paperDim}`,
  },
  clueItemFresh: {
    borderLeft: `3px solid ${noir.crimson}`,
    boxShadow: `0 0 0 2px ${noir.crimson}33`,
  },
  chips: {
    display: "flex",
    gap: 8,
    overflowX: "auto",
    padding: "8px 16px",
    borderTop: `1px solid ${noir.ink}`,
  },
  chip: {
    flex: "0 0 auto",
    background: noir.paper,
    color: noir.ink,
    border: "none",
    borderRadius: 999,
    padding: "10px 14px",
    fontSize: 13,
    cursor: "pointer",
    fontFamily: font,
    minHeight: 40,
  },
  chipUsed: { background: noir.paperDim, color: "#7a7160", opacity: 0.55, cursor: "default" },
  inputRow: { display: "flex", gap: 8, padding: "8px 16px 16px" },
  input: {
    flex: 1,
    padding: "12px 14px",
    borderRadius: 10,
    border: `1px solid ${noir.amber}`,
    background: noir.ink,
    color: noir.paper,
    fontSize: 15,
    fontFamily: font,
    minWidth: 0,
  },
  send: {
    background: noir.amber,
    color: noir.ink,
    border: "none",
    borderRadius: 10,
    padding: "0 18px",
    fontSize: 15,
    fontWeight: 700,
    cursor: "pointer",
    fontFamily: font,
    minHeight: 48,
  },
};
