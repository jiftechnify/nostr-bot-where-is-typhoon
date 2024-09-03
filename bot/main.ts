import * as nip19 from "nostr-tools/nip19";
import { NostrEventUnsigned } from "./nostr.ts";
import { NPool, NRelay1, NSchema, NSecSigner } from "@nostrify/nostrify";
import { GenmapClient, makeGenmapClient } from "./genmap.ts";
import {
  fetchTargetTropicalCyclones,
  fetchTropicalCycloneForecast,
  fetchTropicalCycloneSpecs,
  TCSpecs,
  TCSpecsSpeed,
} from "./typhoon_api.ts";

import "@std/dotenv/load";

function formatDate(jst: string): string {
  const dt = Temporal.ZonedDateTime.from(`${jst}[Asia/Tokyo]`);
  const min = String(dt.minute).padStart(2, "0");
  return `${dt.year}年${dt.month}月${dt.day}日 ${dt.hour}時${min}分`;
}

function formatTropicalCycloneName([header]: TCSpecs): string {
  if (header.name !== undefined) {
    const typhoonNum = `台風${header.typhoonNumber.substring(2)}号(${header.name.jp})`;
    if (!header.category.jp.includes("台風")) {
      return `${typhoonNum}(${header.category.jp}に変化)`;
    }
    return typhoonNum;
  }
  // 未命名
  return `${header.category.jp}${header.typhoonNumber}`;
}

function formatSpeed(speed: TCSpecsSpeed, course: string | undefined): string {
  if (speed["km/h"] !== undefined) {
    return `を ${course}へ 毎時${speed["km/h"]}kmの速度で 進んでいます`;
  }
  if (speed.note?.jp !== undefined) {
    if (speed.note.jp === "ゆっくり") {
      return `を ${course}へ ゆっくり 進んでいます`;
    } else { // 「停滞」or「ほぼ停滞」
      return `で ${speed.note.jp} しています`;
    }
  }
  return "";
}

function formatSpecLine1(specs: TCSpecs): string {
  const [_, body1] = specs;
  const intensity = body1.intensity === "-" ? "" : `${body1.intensity} `;

  return `${intensity}${formatTropicalCycloneName(specs)}は、${
    formatDate(body1.validtime.JST)
  }現在 ${body1.location}${formatSpeed(body1.speed, body1.course)}。`;
}

function formatSpecLine2([_, ...[body1]]: TCSpecs): string {
  if (body1.maximumWind === undefined) {
    return `中心気圧は ${body1.pressure}hPa です。`;
  }
  return `中心気圧は ${body1.pressure}hPa、最大風速は 秒速${
    body1.maximumWind.sustained["m/s"]
  }m、最大瞬間風速は 秒速${body1.maximumWind.gust["m/s"]}m です。`;
}

function formatTCSpecs(
  specs: TCSpecs,
  mapUrl: string,
): string {
  const [header] = specs;

  const issueDatetimeLine = `(${formatDate(header.issue.JST)} 発表)`;
  return [
    formatSpecLine1(specs),
    formatSpecLine2(specs),
    issueDatetimeLine,
    mapUrl,
  ].join("\n");
}

async function fetchAllTropicalCyclonData() {
  const targetTCs = await fetchTargetTropicalCyclones();
  if (targetTCs.length === 0) {
    return undefined;
  }

  const tcs = await Promise.all(
    targetTCs.map(async ({ tropicalCyclone: tcid }) => {
      return {
        tcid,
        specs: await fetchTropicalCycloneSpecs(tcid),
        forecast: await fetchTropicalCycloneForecast(tcid),
      };
    }),
  );
  const maxIssueTime = tcs.reduce((max, { specs }) => {
    const issueTime = specs[0].issue.JST;
    return issueTime.localeCompare(max) > 0 ? issueTime : max;
  }, "");

  return {
    tcs,
    maxIssueTime,
  };
}

const noTCs =
  "現在、台風または今後台風になると予想される熱帯低気圧は発生していません。";

const footer =
  "最新の台風情報については気象庁ホームページ https://www.jma.go.jp/bosai/map.html#contents=typhoon を参照してください。";

let latestTCsExist = true;
let latestIssueTime = "";
let latestPostId = "";

function currUnixtime(): number {
  return Math.floor(Date.now() / 1000);
}

async function composeTyphoonPositionPost(genmap: GenmapClient): Promise<
  NostrEventUnsigned | undefined
> {
  const allTCData = await fetchAllTropicalCyclonData();
  if (allTCData === undefined) {
    console.log("台風なし");

    if (latestTCsExist) {
      latestTCsExist = false;
      return {
        kind: 1,
        content: [noTCs, footer].join("\n\n"),
        created_at: currUnixtime(),
        tags: [],
      };
    }
    return undefined;
  }

  console.log(
    "最終更新時刻:",
    latestIssueTime,
    "今回取得データの最大発表時刻:",
    allTCData.maxIssueTime,
  );
  if (allTCData.maxIssueTime.localeCompare(latestIssueTime) <= 0) {
    console.log("更新なし");
    return undefined;
  }

  latestTCsExist = true;
  latestIssueTime = allTCData.maxIssueTime;

  const formattedSpecs = await Promise.all(
    allTCData.tcs.map(
      async (
        {
          specs,
          forecast: [_, ...[forecastBody1]],
        },
      ) => {
        const [specsHeader, ...[specsBody1]] = specs;

        const mapUrl = await genmap({
          typhoonNumber: specsHeader.typhoonNumber,
          validtime: specsBody1.validtime.JST,
          center: forecastBody1.center,
          track: forecastBody1.track,
          stormWarningArea: forecastBody1.stormWarningArea,
          galeWarningArea: forecastBody1.galeWarningArea,
        });

        return formatTCSpecs(specs, mapUrl);
      },
    ),
  );
  const content = [...formattedSpecs, footer].join("\n\n");
  return {
    kind: 1,
    content,
    created_at: Math.floor(Date.now() / 1000),
    tags: [],
  };
}

type Context = {
  pool: NPool;
  signer: NSecSigner;
  genmap: GenmapClient;
};

function postTyphoonPosition({ pool, signer, genmap }: Context) {
  return async () => {
    try {
      const post = await composeTyphoonPositionPost(genmap);
      if (post === undefined) {
        return;
      }

      const signed = await signer.signEvent(post);
      latestPostId = signed.id;
      console.log(signed);

      await pool.event(signed);
    } catch (err) {
      console.error(err);
    }
  };
}

function launchResponder({ pool, signer }: Context): void {
  const serve = async () => {
    const recvEvIds = new Set<string>();
    const botPubkey = await signer.getPublicKey();

    const it = pool.req([{ kinds: [1], since: Math.floor(Date.now() / 1000) }]);
    for await (const m of it) {
      const parsed = NSchema.relayEVENT().safeParse(m);
      if (!parsed.success) {
        continue;
      }
      const ev = parsed.data[2];
      if (recvEvIds.has(ev.id)) {
        continue;
      }
      recvEvIds.add(ev.id);

      if (
        ev.pubkey !== botPubkey && ev.content.includes("台風") &&
        ev.content.includes("どこ") &&
        ["?", "？"].some((q) => ev.content.includes(q))
      ) {
        console.log("received 台風どこ");
        const nevent = nip19.neventEncode({
          id: latestPostId,
          kind: 1,
          author: botPubkey,
        });
        const reply: NostrEventUnsigned = {
          kind: 1,
          content: `nostr:${nevent}`,
          created_at: Math.max(currUnixtime(), ev.created_at + 1),
          tags: [
            ["p", ev.pubkey, ""],
            ["e", ev.id, "", "root", ev.pubkey],
            ["e", latestPostId, "", "mention", botPubkey],
          ],
        };
        const signed = await signer.signEvent(reply);
        await pool.event(signed);
      }
    }
  };

  serve().catch((e) => console.error(e));
}

const readRelayURLs = [
  "wss://yabu.me",
  "wss://relay-jp.nostr.wirednet.jp",
  "wss://nrelay.c-stellar.net",
  "wss://nrelay-jp.c-stellar.net",
];
const writeRelayURLs = [
  "wss://yabu.me",
  "wss://relay-jp.nostr.wirednet.jp",
  "wss://nrelay-jp.c-stellar.net",
];

if (import.meta.main) {
  const nsec = Deno.env.get("NOSTR_SECRET_KEY");
  if (!nsec || !nsec.startsWith("nsec1")) {
    console.error("missing or invalid NOSTR_SECRET_KEY");
    Deno.exit(1);
  }
  const genmapBaseUrl = Deno.env.get("GENMAP_BASE_URL");
  if (!genmapBaseUrl) {
    console.error("missing GENMAP_BASE_URL");
    Deno.exit(1);
  }

  try {
    const seckey = nip19.decode(nsec as `nsec1${string}`);

    const signer = new NSecSigner(seckey.data);
    const pool = new NPool({
      open(url) {
        return new NRelay1(url);
      },
      reqRouter(filters) {
        return Promise.resolve(
          new Map(readRelayURLs.map((rurl) => [rurl, filters])),
        );
      },
      eventRouter() {
        return Promise.resolve(writeRelayURLs);
      },
    });

    const ctx: Context = {
      signer,
      pool,
      genmap: makeGenmapClient(genmapBaseUrl),
    };

    // (5n+1)分に定時処理を実行
    Deno.cron("cron", "1-59/5 * * * *", postTyphoonPosition(ctx));
    // 「台風どこ?」に反応する処理を起動
    launchResponder(ctx);
  } catch (err) {
    console.error(err);
    Deno.exit(1);
  }
}
