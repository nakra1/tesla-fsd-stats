// api/tesla-webhook.js
// Receives Teslemetry's webhook POST and stores the latest FSD stats in Redis (Upstash).
//
// Setup required in Vercel dashboard:
//   1. Storage tab -> Browse Storage -> Upstash -> create a Redis database ->
//      connect it to this project. Check Settings -> Environment Variables
//      afterward to confirm the exact injected variable names (commonly
//      KV_REST_API_URL / KV_REST_API_TOKEN, but verify against your dashboard).
//   2. Settings -> Environment Variables -> add WEBHOOK_SECRET (any random string
//      you make up yourself) -> also paste that same string into Teslemetry's
//      webhook "Authorization" header field when you configure it there.

import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN,
});

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // Basic shared-secret check so random internet traffic can't write fake data.
  const auth = req.headers["authorization"];
  if (auth !== `Bearer ${process.env.WEBHOOK_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const { data, createdAt, vin, state } = req.body || {};

    // Teslemetry sends periodic connectivity/state pings (e.g. {vin, createdAt, state:"online"})
    // with no "data" field. These are normal and frequent — just acknowledge, don't log each one.
    if (!data) {
      return res.status(200).json({ ok: true, type: "state_ping" });
    }

    // Teslemetry reports fields independently as they update — a single payload
    // may contain only one of the two fields we care about, not both together.
    // Merge whatever arrives with whatever we already have stored.
    const hasMiles = data.MilesSinceReset !== undefined;
    const hasSelfDriving = data.SelfDrivingMilesSinceReset !== undefined;

    if (!hasMiles && !hasSelfDriving) {
      // Payload had a data object, but not either field we track — nothing to do.
      return res.status(200).json({ ok: true, type: "unrelated_field" });
    }

    const existing = (await redis.get("tesla:fsd-stats")) || {};

    const milesSinceReset = hasMiles
      ? parseFloat(data.MilesSinceReset)
      : existing.milesSinceReset;
    const selfDrivingMiles = hasSelfDriving
      ? parseFloat(data.SelfDrivingMilesSinceReset)
      : existing.selfDrivingMiles;

    if (milesSinceReset === undefined || selfDrivingMiles === undefined) {
      // We have one field now but have never received the other one yet —
      // not enough to compute a percentage. Store what we have and wait.
      await redis.set("tesla:fsd-stats", {
        ...existing,
        ...(hasMiles && { milesSinceReset }),
        ...(hasSelfDriving && { selfDrivingMiles }),
        vin: vin || existing.vin || null,
        updatedAt: createdAt || new Date().toISOString(),
      });
      return res.status(200).json({ ok: true, type: "partial_data_stored" });
    }

    const percent =
      milesSinceReset > 0
        ? Math.round((selfDrivingMiles / milesSinceReset) * 1000) / 10
        : 0;

    await redis.set("tesla:fsd-stats", {
      milesSinceReset,
      selfDrivingMiles,
      percent,
      vin: vin || existing.vin || null,
      updatedAt: createdAt || new Date().toISOString(),
    });

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Webhook error:", err);
    return res.status(500).json({ error: "Internal error" });
  }
}
