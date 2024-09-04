// 緯度・軽度 [degrees]
export type LatLng = [number, number];

// 暴風域・強風域の範囲
export type TCWarningArea = TCWarningAreaCircle | TCWarningAreaArc;

export type TCWarningAreaCircle = {
  center: LatLng;
  radius: number; // [m]
};

export type TCWarningAreaArc = {
  arc: [center: LatLng, radius: number, [number, number]];
};

export function isWarningAreaCircle(
  wa: TCWarningArea,
): wa is TCWarningAreaCircle {
  return "center" in wa && "radius" in wa;
}

// 熱帯低気圧の軌跡
export type TCTrack = {
  preTyphoon: LatLng[]; // 台風になる前
  typhoon: LatLng[]; // 台風になった後
};
