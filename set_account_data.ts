import { publishToRelays } from "./nostr.ts";
import * as nip19 from "nostr-tools/nip19";
import { NSecSigner } from "@nostrify/nostrify";

const writeRelayURLs = [
  "wss://yabu.me",
  "wss://relay-jp.nostr.wirednet.jp",
  "wss://nrelay-jp.c-stellar.net",
];

const profile = {
  "name": "where_is_typhoon",
  "display_name": "どこどこ台風bot",
  "about":
    "現在発生中の台風の現在位置などの情報をお伝えします。情報の更新は毎時50分頃。\n管理者: かすてらふぃ(NIP-05: jiftechnify@c-stellar.net)\n",
  "picture": "https://pubimgs.c-stellar.net/where_is_typhoon.webp",
  "nip05": "where_is_typhoon@c-stellar.net",
  "bot": true,
};

if (import.meta.main) {
  const nsec = Deno.env.get("NOSTR_SECRET_KEY");
  if (!nsec || !nsec.startsWith("nsec1")) {
    console.error("missing or invalid NOSTR_SECRET_KEY");
    Deno.exit(1);
  }
  const seckey = nip19.decode(nsec as `nsec1${string}`);
  const signer = new NSecSigner(seckey.data);

  const k0 = {
    kind: 0,
    content: JSON.stringify(profile),
    tags: [],
    created_at: Math.floor(Date.now() / 1000),
  };
  const signed = await signer.signEvent(k0);
  await publishToRelays(writeRelayURLs, signed);
}
