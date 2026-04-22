# Formula 1 Telemetry Platform

Full-stack thesis project for importing, caching, aligning, and visualizing Formula 1 telemetry from the OpenF1 API.

## Stack

- Backend: Express + TypeScript + Prisma
- Database: PostgreSQL
- Frontend: React + Vite + TypeScript
- Data source: OpenF1

## Main Features

1. Search remote sessions from OpenF1
2. Import session, driver, and lap metadata into PostgreSQL
3. Lazily import telemetry for chosen laps only, so OpenF1 rate limits stay manageable
4. Cache imported telemetry and computed lap comparisons in the database
5. Align laps on a shared distance axis
6. Compute delta time, smoothing, and braking-zone events
7. Visualize the comparison in a React dashboard

## Project Structure

- `apps/api` - backend, Prisma schema, import pipeline, telemetry analysis
- `apps/web` - React frontend
- `docs` - thesis text and technical materials
- `scripts/create-db.ps1` - creates the dedicated PostgreSQL database

## Quick Start

```powershell
npm install
npm run db:create
npm run db:push
npm run dev
```

Frontend: [http://localhost:5173](http://localhost:5173)  
Backend: [http://localhost:4000](http://localhost:4000)

## Database

The local environment is configured for:

- host: `127.0.0.1`
- user: `postgres`
- password: `1234`
- database: `f1_telemetry_platform_ts`

These values are already placed in `.env`.

## API Overview

- `GET /api/health`
- `GET /api/openf1/sessions?year=2024&sessionName=Qualifying`
- `POST /api/import/session`
- `GET /api/sessions`
- `GET /api/sessions/:sessionId/overview`
- `POST /api/analysis/compare`

## Import Strategy

To respect OpenF1 limits, the system imports metadata immediately and telemetry on demand. When a user compares two laps, the backend fetches `car_data` and `location` only for those specific lap time windows, stores the result in PostgreSQL, and reuses it later.
