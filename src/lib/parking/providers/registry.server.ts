// Provider registry. Lookup is city -> provider for sync;
// future providers (CurbIQ, Los Angeles, etc.) plug in here.

import { SeattleBlockfaceProvider } from "./seattle-blockface.server";
import type { ParkingProvider } from "./types";

const REGISTRY: ParkingProvider[] = [
  SeattleBlockfaceProvider,
  // future: CurbIQProvider, LosAngelesProvider, ...
];

export function getProviderForCity(citySlug: string): ParkingProvider | null {
  return REGISTRY.find((p) => p.cities.includes(citySlug)) ?? null;
}

export function listProviders(): ParkingProvider[] {
  return REGISTRY;
}
