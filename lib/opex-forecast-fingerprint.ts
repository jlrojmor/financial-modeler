import type { OpExForecastConfigV1 } from "@/types/opex-forecast-v1";

export function getOpExForecastConfigFingerprint(config: OpExForecastConfigV1 | undefined): string {
  return JSON.stringify(config?.lines ?? {});
}
