# Technical Specification for the Formula 1 Telemetry Platform

## 1. System Goal

Build a web application that retrieves Formula 1 telemetry from the OpenF1 API, processes asynchronous raw signals into aligned distance-based datasets, stores reusable results in PostgreSQL, and exposes an interactive dashboard for comparative analysis between drivers and laps.

## 2. Proposed Technology Stack

Backend:
- Node.js
- TypeScript
- Express or Fastify
- Prisma or TypeORM
- PostgreSQL

Frontend:
- React
- TypeScript
- Vite or Next.js
- High-performance charting library such as ECharts or D3-based custom rendering

Testing:
- Vitest or Jest for unit tests
- Playwright for end-to-end scenarios
- Profiling with browser devtools and React performance tools

## 3. Core Functional Modules

### 3.1 Data Ingestion

Inputs:
- Session metadata from OpenF1
- Driver metadata
- Lap data
- Telemetry channels such as speed, throttle, brake, gear, RPM, and position

Responsibilities:
- Fetch API data
- Validate response shape
- Normalize types and field names
- Handle retries and partial failures

### 3.2 Data Processing

Responsibilities:
- Sort telemetry records
- Remove duplicates
- Fill or flag missing values
- Estimate cumulative distance
- Smooth noisy signals
- Interpolate data to a shared distance grid
- Generate delta-time arrays
- Detect braking and throttle events

### 3.3 Persistence

Responsibilities:
- Store source data for reproducibility
- Cache processed outputs
- Support quick session and lap lookup
- Reduce repeated external API usage

### 3.4 API Layer

Suggested endpoints:
- `GET /sessions`
- `GET /sessions/:id/drivers`
- `GET /sessions/:id/laps`
- `POST /analysis/compare`
- `GET /analysis/cache/:key`

### 3.5 Frontend Dashboard

Responsibilities:
- Session selection
- Driver and lap selection
- Multi-chart telemetry visualization
- Shared crosshair across charts
- Delta-time overview
- Event markers for braking and apex regions

## 4. Functional Requirements

1. The user can choose a session and driver combination.
2. The system can retrieve telemetry from OpenF1 on first request.
3. The system stores processed outputs for later reuse.
4. The system aligns multiple laps on the same distance axis.
5. The system computes delta time between selected laps.
6. The system renders large telemetry arrays without severe UI degradation.
7. The system displays synchronized charts for key telemetry channels.
8. The system highlights track events detected by derived logic.

## 5. Non-Functional Requirements

1. Type-safe backend and frontend implementation.
2. Response times for cached comparisons should be significantly lower than first-time processing.
3. Mathematical functions must be covered by unit tests.
4. Rendering should remain smooth during interaction with large data series.
5. The architecture should remain modular enough for future extension.

## 6. Preliminary Data Model

### sessions
- id
- year
- country_name
- circuit_short_name
- session_name
- date_start

### drivers
- id
- session_id
- driver_number
- full_name
- team_name

### laps
- id
- session_id
- driver_id
- lap_number
- lap_duration
- is_valid

### raw_telemetry_points
- id
- session_id
- driver_id
- lap_id
- timestamp
- speed
- throttle
- brake
- gear
- rpm
- x
- y
- z

### processed_telemetry_sets
- id
- comparison_key
- distance_step
- source_lap_ids
- aligned_payload
- created_at

### delta_time_sets
- id
- comparison_key
- reference_lap_id
- target_lap_id
- delta_payload
- created_at

## 7. Algorithms to Implement

1. Cumulative distance estimation from ordered position samples.
2. Signal smoothing with a method that preserves major driver actions.
3. Linear interpolation on a shared distance grid.
4. Optional spline interpolation for smoother visual comparison.
5. Delta-time calculation over micro-sectors.
6. Event detection for braking onset and throttle pickup.

## 8. Testing Plan

Unit tests:
- Interpolation between known points
- Distance monotonicity checks
- Delta-time validation on synthetic laps
- Data cleaning edge cases

Integration tests:
- OpenF1 fetch and normalization
- Database persistence and cache retrieval
- End-to-end comparison request flow

Performance tests:
- Processing large telemetry sessions
- Rendering tens of thousands of chart points
- Crosshair synchronization under user interaction

## 9. Deliverables

1. Thesis document
2. Source code for backend and frontend
3. Database schema and migration files
4. Automated tests
5. Evaluation results for correctness and performance
