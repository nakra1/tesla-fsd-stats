// api/tesla-stats.js
// Returns the latest stored FSD stats for the dashboard page to display.

import { kv } from "@vercel/kv";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const stats = await kv.get("tesla:fsd-stats");

    if (!stats) {
      return res.status(200).json({
        milesSinceReset: null,
        selfDrivingMiles: null,
        percent: null,
        updatedAt: null,
        message: "No data received yet",
      });
    }

    return res.status(200).json(stats);
  } catch (err) {
    console.error("Stats fetch error:", err);
    return res.status(500).json({ error: "Internal error" });
  }
}
