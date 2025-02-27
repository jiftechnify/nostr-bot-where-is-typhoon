import { LatLng, TCTrack, TCWarningAreaCircle } from "./common_types.ts";

type GenmapReq = {
  typhoonNumber: string;
  validtime: string;
  center: LatLng;
  track: TCTrack;
  stormWarningArea?: TCWarningAreaCircle;
  galeWarningArea?: TCWarningAreaCircle;
};

type GenmapResp = {
  url: string;
};

export type GenmapClient = (req: GenmapReq) => Promise<string>;

export function makeGenmapClient(baseUrl: string): GenmapClient {
  return async (req: GenmapReq) => {
    const endpoint = `${baseUrl}/genmap`;
    const resp = await fetch(endpoint, {
      method: "POST",
      body: JSON.stringify(req),
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) {
      throw Error("failed to generate map image");
    }

    const { url: mapImgUrl } = await resp.json() as unknown as GenmapResp;
    return mapImgUrl;
  };
}
