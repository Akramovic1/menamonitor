# MENA Monitor

**Real-time Iran-Israel conflict intelligence dashboard** — neutral, fair, open source. Forked from [World Monitor](https://github.com/koala73/worldmonitor).

## Features

- **Two-Sided News** — Iran-side and Israel-side sources shown side-by-side with bias labels
- **AI Fact-Check** — Claims from both sides cross-referenced against neutral sources
- **Conflict Scorecard** — Damage and casualty tracking per side
- **Missile & Strike Tracker** — Launch, interception, and impact events
- **Military Flight Tracking** — Real-time MENA airspace monitoring
- **Ship Tracking** — Strait of Hormuz tanker traffic and naval vessels
- **Alliance Tracker** — Which countries support which side
- **Country Instability Index** — Real-time stability scores for MENA nations
- **Israel Rocket Sirens** — Live alert feed
- **Telegram Intel** — OSINT from curated Telegram channels
- **40+ News Sources** — Curated with source tiering and propaganda risk ratings

## Neutrality

MENA Monitor is designed to be strictly neutral:
- Equal representation of both sides
- Every source tagged with propaganda risk level
- AI fact-checking with transparent source chains
- Open source — anyone can audit for bias

## Quick Start

```bash
git clone https://github.com/Akramovic1/menamonitor.git
cd menamonitor
cp .env.local.example .env.local
# Fill in free API keys (see .env.local.example for links)
npm install
npm run dev
```

Open http://localhost:5173

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | TypeScript, Vite, deck.gl, MapLibre GL |
| AI | Groq (Llama 3.1), OpenRouter (fallback) |
| Cache | Upstash Redis |
| Hosting | Vercel Edge Functions |
| Data | 40+ RSS feeds, GDELT, ACLED, OpenSky, NASA FIRMS, AIS |

## Cost

$0/month. All services use free tiers.

## License

MIT
