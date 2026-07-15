// api/tesla-webhook.js
// Receives Teslemetry's webhook POST and stores the latest FSD stats in Vercel KV.
//
// Setup required in Vercel dashboard:
//   1. Storage tab -> Create Database -> KV -> connect to this project
//      (this auto-injects KV_REST_API_URL / KV_REST_API_TOKEN env vars)
//   2. Settings -> Environment Variables -> add WEBHOOK_SECRET (any random string
//      you make up yourself) -> also paste that same string into Teslemetry's
//      webhook "Authorization" header field when you configure it there.

import { kv } from "@vercel/kv";

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
    const { data, createdAt, vin } = req.body;

    if (!data || !data.MilesSinceReset || !data.SelfDrivingMilesSinceReset) {
      return res.status(400).json({ error: "Missing expected fields" });
    }

    const milesSinceReset = parseFloat(data.MilesSinceReset);
    const selfDrivingMiles = parseFloat(data.SelfDrivingMilesSinceReset);
    const percent =
      milesSinceReset > 0
        ? Math.round((selfDrivingMiles / milesSinceReset) * 1000) / 10
        : 0;

    await kv.set("tesla:fsd-stats", {
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
