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
    console.log("Raw webhook body:", JSON.stringify(req.body));

    const { data, createdAt, vin, state } = req.body || {};

    // Teslemetry also sends connectivity/state pings (e.g. {vin, createdAt, state:"online"})
    // with no "data" field. These are normal and not an error — just acknowledge them.
    if (!data) {
      console.log("Connectivity/state ping received, no data fields — ignoring.");
      return res.status(200).json({ ok: true, type: "state_ping" });
    }

    if (!data.MilesSinceReset || !data.SelfDrivingMilesSinceReset) {
      console.log("Data payload missing expected fields:", JSON.stringify(data));
      return res.status(200).json({ ok: true, debug: "data present but fields missing" });
    }

    const milesSinceReset = parseFloat(data.MilesSinceReset);
    const selfDrivingMiles = parseFloat(data.SelfDrivingMilesSinceReset);
    const percent =
      milesSinceReset > 0
        ? Math.round((selfDrivingMiles / milesSinceReset) * 1000) / 10
        : 0;

    await redis.set("tesla:fsd-stats", {
      milesSinceReset,
      selfDrivingMiles,
      percent,
      vin: vin || null,
      updatedAt: createdAt || new Date().toISOString(),
    });

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Webhook error:", err);
    return res.status(500).json({ error: "Internal error" });
  }
}
