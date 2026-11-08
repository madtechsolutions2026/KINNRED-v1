import { authedFetch } from "./api";
import type { GridRadius } from "./grid-api";
export type PlanRequestState = "PENDING" | "ACCEPTED" | "REJECTED";
export interface Plan {
  publicShortId: string;
  title: string;
  description: string;
  place: string;
  startsAt: string;
  owner: {
    publicShortId: string;
    username: string | null;
    displayName: string | null;
  };
  isOwner: boolean;
  myRequest: PlanRequestState | null;
  acceptedCount: number;
  requests: {
    publicShortId: string;
    displayName: string | null;
    state: PlanRequestState;
  }[];
}
export const getPlans = (
  radiusMeters: GridRadius | undefined,
  mine = false,
  cursor?: string,
) =>
  authedFetch<{ results: Plan[]; nextCursor: string | null }>(
    `/plans?mine=${mine}${radiusMeters !== undefined ? "&radiusMeters=" + radiusMeters : ""}${cursor ? "&cursor=" + encodeURIComponent(cursor) : ""}`,
  );
export const createPlan = (body: {
  title: string;
  description: string;
  place: string;
  startsAt: string;
}) => authedFetch<Plan>("/plans", { method: "POST", body });
export const requestPlan = (id: string) =>
  authedFetch<{ state: PlanRequestState }>(`/plans/${id}/requests`, {
    method: "POST",
  });
export const withdrawPlan = (id: string) =>
  authedFetch(`/plans/${id}/requests/me`, { method: "DELETE" });
export const decidePlan = (
  id: string,
  requester: string,
  state: "ACCEPTED" | "REJECTED",
) =>
  authedFetch(`/plans/${id}/requests/${requester}`, {
    method: "PATCH",
    body: { state },
  });
export const cancelPlan = (id: string) =>
  authedFetch(`/plans/${id}`, { method: "DELETE" });
