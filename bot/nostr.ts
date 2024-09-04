import { relayInit } from "nostr-tools/relay";

type NostrEvent = {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
};

export type NostrEventUnsigned = Omit<NostrEvent, "id" | "pubkey" | "sig">;

export const publishToRelays = async (
  relayUrls: string[],
  ev: NostrEvent,
  timeoutSec = 5,
): Promise<void> => {
  let canceled = false;
  const timeout = (rurl: string) =>
    new Promise<void>((resolve, reject) => {
      setTimeout(() => {
        if (canceled) {
          resolve();
          return;
        }
        console.error(`[${rurl}] publish timed out`);
        reject("timed out");
      }, timeoutSec * 1000);
    });

  const pub = async (rurl: string, signed: NostrEvent) => {
    const r = relayInit(rurl);
    await r.connect();
    await r
      .publish(signed)
      .then(() => console.debug(`[${rurl}] ok`))
      .catch((e) => console.error(`[${rurl}] failed: ${e}`));
    canceled = true;
    r.close();
  };

  console.info(`publishing event to ${relayUrls.length} relays...`);
  await Promise.allSettled(
    relayUrls.map((rurl) => Promise.race([pub(rurl, ev), timeout(rurl)])),
  );
};
