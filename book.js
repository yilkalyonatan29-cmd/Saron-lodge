// Vercel serverless function: POST /api/book
// Env vars (Vercel > Project > Settings > Environment Variables):
//   RESEND_API_KEY  - from resend.com
//   BOOKING_TO      - lodge inbox, e.g. reservation@saronlodge.com
//   BOOKING_FROM    - verified sender, e.g. "Saron Lodge <bookings@yourdomain.com>"

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

async function send(payload) {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(`Resend ${r.status}: ${await r.text()}`);
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const b = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  if (b.website) return res.status(200).json({ ok: true }); // honeypot for bots

  const { name, phone, email, arrival, departure, rooms, adults, children, type, notes } = b;
  const nights = Math.round((new Date(departure) - new Date(arrival)) / 864e5);

  if (!name || !phone || !/^\S+@\S+\.\S+$/.test(email || "") || !(nights >= 1 && nights <= 60)) {
    return res.status(400).json({ error: "Please check your name, contact details and dates." });
  }
  if (!process.env.RESEND_API_KEY || !process.env.BOOKING_TO || !process.env.BOOKING_FROM) {
    return res.status(500).json({ error: "Booking service is not configured yet." });
  }

  const ref = "SL-" + Date.now().toString(36).toUpperCase();
  const rows = [
    ["Reference", ref], ["Name", name], ["Phone", phone], ["Email", email],
    ["Arrival", arrival], ["Departure", `${departure} (${nights} night${nights > 1 ? "s" : ""})`],
    ["Rooms", rooms], ["Adults", adults], ["Children", children], ["Type", type], ["Notes", notes || "-"],
  ];
  const table = rows.map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0"><b>${k}</b></td><td>${esc(v)}</td></tr>`).join("");

  try {
    await send({
      from: process.env.BOOKING_FROM,
      to: process.env.BOOKING_TO,
      reply_to: email,
      subject: `New booking request ${ref} – ${name}`,
      html: `<h2>New booking request</h2><table>${table}</table>`,
    });
    await send({
      from: process.env.BOOKING_FROM,
      to: email,
      subject: `Saron Lodge – we received your request (${ref})`,
      html: `<p>Dear ${esc(name)},</p><p>Thank you for choosing Saron Lodge. We received your request and our team will confirm availability shortly. This is not yet a confirmed booking.</p><table>${table}</table><p>Saron Lodge, Dilla, Southern Ethiopia</p>`,
    });
    return res.status(200).json({ ok: true, ref });
  } catch (e) {
    console.error(e);
    return res.status(502).json({ error: "Could not send your request. Please call us or email reservation@saronlodge.com." });
  }
}
