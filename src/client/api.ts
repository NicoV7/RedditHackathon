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
};

export type Api = typeof api;
