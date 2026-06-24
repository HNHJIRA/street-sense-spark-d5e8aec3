// Centralized config for the external ParkClear parking-sign analysis API.
// All values come from environment variables / Lovable Secrets so we can later
// swap bearer-token auth for a service-account login + refresh flow WITHOUT
// touching the Scan Sign UI or business logic.
//
// SERVER-ONLY: process.env is only populated in server functions / server
// routes. Never import this file from client code.

export interface ParkingApiConfig {
  baseUrl: string;
  bearerToken: string;
  /** Endpoint paths are centralized so a future auth/upload swap is one edit. */
  endpoints: {
    presignedUrl: string;
    parkingSignAnalysis: string;
  };
}

function readEnv(name: string): string | undefined {
  const v = process.env[name];
  return v && v.length > 0 ? v : undefined;
}

export function getParkingApiConfig(): ParkingApiConfig {
  const baseUrl = readEnv("PARKING_API_BASE_URL");
  const bearerToken = readEnv("PARKING_BEARER_TOKEN");
  if (!baseUrl) throw new Error("PARKING_API_BASE_URL is not configured");
  if (!bearerToken) throw new Error("PARKING_BEARER_TOKEN is not configured");
  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    bearerToken,
    endpoints: {
      // NOTE: exact path TBD — adjust here once confirmed from the Postman
      // collection. All callers read these from config, never hardcoded.
      presignedUrl: "/authentication/v1/get-presigned-url/",
      parkingSignAnalysis: "/authentication/v1/parking-sign-analysis/",
    },
  };
}

export function authHeader(cfg: ParkingApiConfig): Record<string, string> {
  return { Authorization: `Bearer ${cfg.bearerToken}` };
}
