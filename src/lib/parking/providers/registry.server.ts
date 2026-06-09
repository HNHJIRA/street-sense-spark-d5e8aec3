// Provider registry.
//
// `getProvidersForCity()` returns every provider that can contribute rules
// for a given city — multiple providers per city are now the norm (e.g.
// SDOT Blockfaces + Signposts + RPZ all layer onto the same Seattle
// segments). `getProviderForCity()` returns the primary provider only and
// remains for back-compat call sites.

import { SeattleBlockfaceProvider } from "./seattle-blockface.server";
import { SeattleSignpostsProvider } from "./seattle-signposts.server";
import { SeattleRpzProvider } from "./seattle-rpz.server";
import { LADOTProvider } from "./ladot.server";
import { SantaMonicaProvider } from "./santa-monica.server";
import { WestHollywoodProvider } from "./west-hollywood.server";
import { PasadenaProvider } from "./pasadena.server";
import type { ParkingProvider } from "./types";

const REGISTRY: ParkingProvider[] = [
  SeattleBlockfaceProvider,
  SeattleSignpostsProvider,
  SeattleRpzProvider,
  LADOTProvider,
  SantaMonicaProvider,
  WestHollywoodProvider,
  PasadenaProvider,
];

export function getProvidersForCity(citySlug: string): ParkingProvider[] {
  return REGISTRY.filter((p) => p.cities.includes(citySlug));
}

export function getProviderForCity(citySlug: string): ParkingProvider | null {
  return getProvidersForCity(citySlug)[0] ?? null;
}

export function listProviders(): ParkingProvider[] {
  return REGISTRY;
}

export function getProviderById(id: string): ParkingProvider | null {
  return REGISTRY.find((p) => p.id === id) ?? null;
}
