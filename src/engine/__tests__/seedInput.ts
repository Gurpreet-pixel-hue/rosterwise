import { buildSeedData } from "../../../prisma/seed-data";
import { buildEngineInput, type BuildExtras } from "../../server/buildEngineInput";
import type { EngineInput } from "../types";

/** EngineInput for a month, built from the in-memory demo seed (no database). */
export function seedInput(month: string, extras: BuildExtras = {}): EngineInput {
  return buildEngineInput(buildSeedData(), month, extras);
}
