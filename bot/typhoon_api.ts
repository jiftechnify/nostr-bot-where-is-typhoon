import { LatLng } from "./common_types.ts";

const TYPHOON_DATA_BASE_URL = "https://www.jma.go.jp/bosai/typhoon/data";

export type TargetTC = {
  tropicalCyclone: string;
  category: string;
};

export async function fetchTargetTropicalCyclones(): Promise<TargetTC[]> {
  const targetTCs = await fetch(`${TYPHOON_DATA_BASE_URL}/targetTc.json`)
    .then((r) => r.json() as unknown as TargetTC[]);

  return targetTCs.sort(({ tropicalCyclone: tc1 }, { tropicalCyclone: tc2 }) =>
    tc1.localeCompare(tc2)
  );
}

type TCForecastHeader = Record<string, unknown>;

type TCForecastWarningArea = {
  radius: number;
  center: LatLng;
};

type TCForecastBody = {
  validtime: {
    JST: string;
  };
  track: {
    preTyphoon: LatLng[];
    typhoon: LatLng[];
  };
  center: LatLng;
  galeWarningArea?: TCForecastWarningArea;
  stormWarningArea?: TCForecastWarningArea;
};

export type TCForecast = [TCForecastHeader, ...TCForecastBody[]];

export function fetchTropicalCycloneForecast(
  tcid: string,
): Promise<TCForecast> {
  return fetch(`${TYPHOON_DATA_BASE_URL}/${tcid}/forecast.json`)
    .then((r) => r.json() as unknown as TCForecast);
}

type TCSpecsHeader = {
  category: {
    jp: string;
    en: string;
  };
  typhoonNumber: string;
  name?: {
    jp: string;
    en: string;
  };
  issue: {
    JST: string;
  };
};

export type TCSpecsSpeed = {
  "km/h"?: string;
  note?: {
    jp: string;
  };
};

type TCSpecsBody = {
  validtime: {
    JST: string;
  };
  intensity: string;
  location: string;
  position: {
    deg: LatLng;
  };
  course?: string;
  speed: TCSpecsSpeed;
  pressure: string;
  maximumWind?: {
    sustained: {
      "m/s": string;
    };
    gust: {
      "m/s": string;
    };
  };
};

export type TCSpecs = [TCSpecsHeader, ...TCSpecsBody[]];

export function fetchTropicalCycloneSpecs(tcid: string): Promise<TCSpecs> {
  return fetch(`${TYPHOON_DATA_BASE_URL}/${tcid}/specifications.json`)
    .then((r) => r.json() as unknown as TCSpecs);
}
