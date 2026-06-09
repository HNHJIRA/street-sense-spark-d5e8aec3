// Provider registry. Lookup is city -> provider for sync.
// Seattle (SeattleBlockfaceProvider) remains untouched as the production
// source for Seattle. LA-region open-data providers are additive.

import { SeattleBlockfaceProvider } from "./seattle-blockface.server";
import { LADOTProvider } from "./ladot.server";
import { SantaMonicaProvider } from "./santa-monica.server";
import { WestHollywoodProvider } from "./west-hollywood.server";
import { PasadenaProvider } from "./pasadena.server";
import type { ParkingProvider } from "./types";

const REGISTRY: ParkingProvider[] = [
  SeattleBlockfaceProvider,
  LADOTProvider,
  SantaMonicaProvider,
  WestHollywoodProvider,
  PasadenaProvider,
];

export function getProviderForCity(citySlug: string): ParkingProvider | null {
  return REGISTRY.find((p) => p.cities.includes(citySlug)) ?? null;
}

export function listProviders(): ParkingProvider[] {
  return REGISTRY;
}
