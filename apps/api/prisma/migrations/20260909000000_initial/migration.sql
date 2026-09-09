-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Session" (
    "id" SERIAL NOT NULL,
    "sessionKey" INTEGER NOT NULL,
    "meetingKey" INTEGER NOT NULL,
    "sessionType" TEXT NOT NULL,
    "sessionName" TEXT NOT NULL,
    "circuitShortName" TEXT NOT NULL,
    "countryCode" TEXT,
    "countryName" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "gmtOffset" TEXT,
    "year" INTEGER NOT NULL,
    "dateStart" TIMESTAMP(3) NOT NULL,
    "dateEnd" TIMESTAMP(3),
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Driver" (
    "id" SERIAL NOT NULL,
    "sessionId" INTEGER NOT NULL,
    "sessionKey" INTEGER NOT NULL,
    "driverNumber" INTEGER NOT NULL,
    "broadcastName" TEXT,
    "fullName" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "acronym" TEXT NOT NULL,
    "teamName" TEXT NOT NULL,
    "teamColour" TEXT,
    "headshotUrl" TEXT,
    "countryCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Driver_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lap" (
    "id" SERIAL NOT NULL,
    "sessionId" INTEGER NOT NULL,
    "driverId" INTEGER NOT NULL,
    "sessionKey" INTEGER NOT NULL,
    "driverNumber" INTEGER NOT NULL,
    "lapNumber" INTEGER NOT NULL,
    "dateStart" TIMESTAMP(3) NOT NULL,
    "lapDuration" DOUBLE PRECISION,
    "durationSector1" DOUBLE PRECISION,
    "durationSector2" DOUBLE PRECISION,
    "durationSector3" DOUBLE PRECISION,
    "speedTrap" INTEGER,
    "speedI1" INTEGER,
    "speedI2" INTEGER,
    "isPitOutLap" BOOLEAN NOT NULL DEFAULT false,
    "stint" INTEGER,
    "tyreCompound" TEXT,
    "tyreAge" INTEGER,
    "telemetryImportedAt" TIMESTAMP(3),
    "telemetryStatus" TEXT NOT NULL DEFAULT 'pending',
    "telemetryMessage" TEXT,
    "telemetryVersion" INTEGER NOT NULL DEFAULT 0,
    "telemetryQuality" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelemetryPoint" (
    "id" SERIAL NOT NULL,
    "lapId" INTEGER NOT NULL,
    "sessionId" INTEGER NOT NULL,
    "driverId" INTEGER NOT NULL,
    "sampleTime" TIMESTAMP(3) NOT NULL,
    "timeOffsetMs" DOUBLE PRECISION NOT NULL,
    "distanceM" DOUBLE PRECISION NOT NULL,
    "relativeDistance" DOUBLE PRECISION NOT NULL,
    "speedKph" DOUBLE PRECISION NOT NULL,
    "throttlePct" DOUBLE PRECISION NOT NULL,
    "brakePct" DOUBLE PRECISION NOT NULL,
    "rpm" INTEGER,
    "gear" INTEGER,
    "drs" INTEGER,
    "x" DOUBLE PRECISION,
    "y" DOUBLE PRECISION,
    "z" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TelemetryPoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComparisonCache" (
    "id" SERIAL NOT NULL,
    "sessionId" INTEGER NOT NULL,
    "referenceLapId" INTEGER NOT NULL,
    "targetLapId" INTEGER NOT NULL,
    "distanceStep" INTEGER NOT NULL,
    "smoothingWindow" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComparisonCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionResult" (
    "id" SERIAL NOT NULL,
    "sessionId" INTEGER NOT NULL,
    "driverId" INTEGER NOT NULL,
    "sessionKey" INTEGER NOT NULL,
    "driverNumber" INTEGER NOT NULL,
    "position" INTEGER,
    "points" INTEGER,
    "numberOfLaps" INTEGER,
    "dnf" BOOLEAN NOT NULL DEFAULT false,
    "dns" BOOLEAN NOT NULL DEFAULT false,
    "dsq" BOOLEAN NOT NULL DEFAULT false,
    "rawDuration" JSONB,
    "rawGapToLeader" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SessionResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PitStop" (
    "id" SERIAL NOT NULL,
    "sessionId" INTEGER NOT NULL,
    "driverId" INTEGER NOT NULL,
    "sessionKey" INTEGER NOT NULL,
    "driverNumber" INTEGER NOT NULL,
    "lapNumber" INTEGER,
    "date" TIMESTAMP(3) NOT NULL,
    "laneDuration" DOUBLE PRECISION,
    "stopDuration" DOUBLE PRECISION,
    "pitDuration" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PitStop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Stint" (
    "id" SERIAL NOT NULL,
    "sessionId" INTEGER NOT NULL,
    "driverId" INTEGER NOT NULL,
    "sessionKey" INTEGER NOT NULL,
    "driverNumber" INTEGER NOT NULL,
    "stintNumber" INTEGER NOT NULL,
    "lapStart" INTEGER NOT NULL,
    "lapEnd" INTEGER NOT NULL,
    "compound" TEXT,
    "tyreAgeAtStart" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Stint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionKey_key" ON "Session"("sessionKey");

-- CreateIndex
CREATE INDEX "Driver_sessionId_acronym_idx" ON "Driver"("sessionId", "acronym");

-- CreateIndex
CREATE UNIQUE INDEX "Driver_sessionId_driverNumber_key" ON "Driver"("sessionId", "driverNumber");

-- CreateIndex
CREATE INDEX "Lap_sessionId_lapDuration_idx" ON "Lap"("sessionId", "lapDuration");

-- CreateIndex
CREATE INDEX "Lap_driverId_dateStart_idx" ON "Lap"("driverId", "dateStart");

-- CreateIndex
CREATE UNIQUE INDEX "Lap_sessionId_driverId_lapNumber_key" ON "Lap"("sessionId", "driverId", "lapNumber");

-- CreateIndex
CREATE INDEX "TelemetryPoint_lapId_distanceM_idx" ON "TelemetryPoint"("lapId", "distanceM");

-- CreateIndex
CREATE INDEX "TelemetryPoint_lapId_sampleTime_idx" ON "TelemetryPoint"("lapId", "sampleTime");

-- CreateIndex
CREATE UNIQUE INDEX "ComparisonCache_referenceLapId_targetLapId_distanceStep_smo_key" ON "ComparisonCache"("referenceLapId", "targetLapId", "distanceStep", "smoothingWindow");

-- CreateIndex
CREATE UNIQUE INDEX "SessionResult_driverId_key" ON "SessionResult"("driverId");

-- CreateIndex
CREATE INDEX "SessionResult_sessionId_position_idx" ON "SessionResult"("sessionId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "SessionResult_sessionId_driverId_key" ON "SessionResult"("sessionId", "driverId");

-- CreateIndex
CREATE INDEX "PitStop_sessionId_driverId_lapNumber_idx" ON "PitStop"("sessionId", "driverId", "lapNumber");

-- CreateIndex
CREATE UNIQUE INDEX "PitStop_sessionId_driverId_date_key" ON "PitStop"("sessionId", "driverId", "date");

-- CreateIndex
CREATE INDEX "Stint_sessionId_driverId_idx" ON "Stint"("sessionId", "driverId");

-- CreateIndex
CREATE UNIQUE INDEX "Stint_sessionId_driverId_stintNumber_key" ON "Stint"("sessionId", "driverId", "stintNumber");

-- AddForeignKey
ALTER TABLE "Driver" ADD CONSTRAINT "Driver_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lap" ADD CONSTRAINT "Lap_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lap" ADD CONSTRAINT "Lap_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelemetryPoint" ADD CONSTRAINT "TelemetryPoint_lapId_fkey" FOREIGN KEY ("lapId") REFERENCES "Lap"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelemetryPoint" ADD CONSTRAINT "TelemetryPoint_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelemetryPoint" ADD CONSTRAINT "TelemetryPoint_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComparisonCache" ADD CONSTRAINT "ComparisonCache_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComparisonCache" ADD CONSTRAINT "ComparisonCache_referenceLapId_fkey" FOREIGN KEY ("referenceLapId") REFERENCES "Lap"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComparisonCache" ADD CONSTRAINT "ComparisonCache_targetLapId_fkey" FOREIGN KEY ("targetLapId") REFERENCES "Lap"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionResult" ADD CONSTRAINT "SessionResult_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionResult" ADD CONSTRAINT "SessionResult_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PitStop" ADD CONSTRAINT "PitStop_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PitStop" ADD CONSTRAINT "PitStop_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Stint" ADD CONSTRAINT "Stint_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Stint" ADD CONSTRAINT "Stint_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE CASCADE ON UPDATE CASCADE;

