export type Band = {
  code: string;
  name: string;
  lower_deg: number;
  upper_deg: number;
  updated_by: string | null;
  updated_at: string | null;
};

export type BandChange = {
  id: number;
  band_code: string;
  band_name: string;
  old_lower_deg: number | null;
  old_upper_deg: number | null;
  new_lower_deg: number;
  new_upper_deg: number;
  changed_by: string;
  changed_at: string;
};

export type LogRow = {
  id: number;
  turbine_code: string;
  yaw_err_deg: number;
  band_code: string | null;
  band_name: string | null;
  band_lower_snap: number | null;
  band_upper_snap: number | null;
  status: string;
  verdict: string | null;
  reason: string | null;
  created_by: string;
  created_at: string;
  processed_at: string | null;
};

export type Session = {
  token: string;
  username: string;
  role: string;
};

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** 统一走 /api 的携带令牌请求；非 2xx 抛出带后端 detail 的 ApiError。 */
export async function apiFetch<T>(
  session: Session,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      Authorization: `Bearer ${session.token}`,
      ...(init?.headers ?? {}),
    },
  });
  const data: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail =
      typeof data === "object" && data !== null && "detail" in data
        ? String((data as { detail: unknown }).detail)
        : `请求失败（${res.status}）`;
    throw new ApiError(res.status, detail);
  }
  return data as T;
}

export function formatTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

export function formatBand(lower: number | null, upper: number | null): string {
  if (lower === null || upper === null) return "—";
  return `[${lower}°, ${upper}°]`;
}
