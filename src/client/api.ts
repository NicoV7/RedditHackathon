/**
 * src/client/api.ts — typed fetch client. One function per server endpoint in
 * shared/api.ts. POSTs JSON to /api/<name> and returns the typed DTO.
 *
 * SECURITY: this client only ever sends nominations/accusations and receives
 * server-revealed clues + the final reveal. It has NO knowledge of the killer.
 */
import type {
  StartCaseRequest,
  StartCaseResponse,
  InterrogateRequest,
  InterrogateResponse,
  ExamineRequest,
  ExamineResponse,
  NominateRequest,
  NominateResponse,
  AccuseRequest,
  AccuseResponse,
  PresentRequest,
  PresentResponse,
  MoveRequest,
  MoveResponse,
  SaveStateRequest,
  SaveStateResponse,
  ResumeRequest,
  ResumeResponse,
  DetectiveRequest,
  DetectiveResponse,
} from "../shared/api.js";

export class ApiError extends Error {
  constructor(
    public readonly endpoint: string,
    public readonly status: number,
    message: string,
  ) {
    super(`POST /api/${endpoint} failed (${status}): ${message}`);
    this.name = "ApiError";
  }
}

async function post<Req, Res>(endpoint: string, body: Req): Promise<Res> {
  const res = await fetch(`/api/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      detail = await res.text();
    } catch {
      // keep statusText
    }
    throw new ApiError(endpoint, res.status, detail);
  }
  return (await res.json()) as Res;
}

export const api = {
  startCase: (req: StartCaseRequest): Promise<StartCaseResponse> =>
    post<StartCaseRequest, StartCaseResponse>("startCase", req),

  interrogate: (req: InterrogateRequest): Promise<InterrogateResponse> =>
    post<InterrogateRequest, InterrogateResponse>("interrogate", req),

  examine: (req: ExamineRequest): Promise<ExamineResponse> =>
    post<ExamineRequest, ExamineResponse>("examine", req),

  nominate: (req: NominateRequest): Promise<NominateResponse> =>
    post<NominateRequest, NominateResponse>("nominate", req),

  accuse: (req: AccuseRequest): Promise<AccuseResponse> =>
    post<AccuseRequest, AccuseResponse>("accuse", req),

  /** present a collected item to an NPC (the "gotcha") — fires presentReactions. */
  present: (req: PresentRequest): Promise<PresentResponse> =>
    post<PresentRequest, PresentResponse>("present", req),

  /** record the player's logical zone for a tick (drives the perception model). */
  move: (req: MoveRequest): Promise<MoveResponse> =>
    post<MoveRequest, MoveResponse>("move", req),

  /** persist the mid-case session (board graph, inventory, faculty XP). */
  saveState: (req: SaveStateRequest): Promise<SaveStateResponse> =>
    post<SaveStateRequest, SaveStateResponse>("saveState", req),

  /** rehydrate today's saved session (or learn it's forfeit / start-fresh). */
  resume: (req: ResumeRequest): Promise<ResumeResponse> =>
    post<ResumeRequest, ResumeResponse>("resume", req),

  /** fetch the persistent detective sheet (faculties, streaks, unlocks). */
  detective: (req: DetectiveRequest): Promise<DetectiveResponse> =>
    post<DetectiveRequest, DetectiveResponse>("detective", req),
};

export type Api = typeof api;
