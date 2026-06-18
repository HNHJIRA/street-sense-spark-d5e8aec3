// Provider registry.
//
// Includes both segment-creating providers (ParkingProvider) and
// overlay providers (OverlayProvider) that attach rules to existing
// segments via PostGIS spatial joins.

import { SeattleBlockfaceProvider } from "./seattle-blockface.server";
import { SeattleSignpostsProvider } from "./seattle-signposts.server";
import { SeattleRpzProvider } from "./seattle-rpz.server";
import { LADOTProvider } from "./ladot.server";
import { SantaMonicaProvider } from "./santa-monica.server";
import { SantaMonicaPermitProvider } from "./santa-monica-permit.server";
import { SantaMonicaMeterProvider } from "./santa-monica-meters.server";
import { WestHollywoodProvider } from "./west-hollywood.server";
import { WestHollywoodPermitOverlay } from "./weho-permit.server";
import { PasadenaProvider } from "./pasadena.server";
import { ArlingtonProvider } from "./arlington.server";
import { ArlingtonPermitOverlay } from "./arlington-permit.server";
import { ArlingtonCurbOverlay } from "./arlington-curb.server";
import { BellevueProvider } from "./bellevue.server";
import { BellevueRpzOverlay } from "./bellevue-rpz.server";
import { BellevueCurbOverlay } from "./bellevue-curb.server";
import type { AnyProvider, OverlayProvider, ParkingProvider } from "./types";
import { isOverlayProvider } from "./types";

const REGISTRY: AnyProvider[] = [
  SeattleBlockfaceProvider,
  SeattleSignpostsProvider,
  SeattleRpzProvider,
  LADOTProvider,
  SantaMonicaProvider,
  SantaMonicaPermitProvider,
  SantaMonicaMeterProvider,
  WestHollywoodProvider,
  WestHollywoodPermitOverlay,
  PasadenaProvider,
  ArlingtonProvider,
  ArlingtonPermitOverlay,
  ArlingtonCurbOverlay,
  BellevueProvider,
  BellevueRpzOverlay,
  BellevueCurbOverlay,
];

export function getProvidersForCity(citySlug: string): AnyProvider[] {
  return REGISTRY.filter((p) => p.cities.includes(citySlug));
}

export function getSegmentProvidersForCity(citySlug: string): ParkingProvider[] {
  return REGISTRY.filter((p) => !isOverlayProvider(p) && p.cities.includes(citySlug)) as ParkingProvider[];
}

export function getOverlayProvidersForCity(citySlug: string): OverlayProvider[] {
  return REGISTRY.filter((p) => isOverlayProvider(p) && p.cities.includes(citySlug)) as OverlayProvider[];
}

export function getProviderForCity(citySlug: string): ParkingProvider | null {
  return getSegmentProvidersForCity(citySlug)[0] ?? null;
}

export function listProviders(): AnyProvider[] {
  return REGISTRY;
}

export function getProviderById(id: string): AnyProvider | null {
  return REGISTRY.find((p) => p.id === id) ?? null;
}
