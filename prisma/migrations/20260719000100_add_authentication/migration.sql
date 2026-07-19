CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'HEAD_NURSE', 'PERSONNEL');

CREATE TABLE "User" (
  "id" TEXT NOT NULL,
  "nationalId" VARCHAR(10) NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "firstName" TEXT NOT NULL,
  "lastName" TEXT NOT NULL,
  "role" "UserRole" NOT NULL DEFAULT 'PERSONNEL',
  "departmentId" TEXT,
  "personnelId" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "mustChangePassword" BOOLEAN NOT NULL DEFAULT true,
  "hasResetRequest" BOOLEAN NOT NULL DEFAULT false,
  "resetRequestedAt" TIMESTAMP(3),
  "passwordResetAt" TIMESTAMP(3),
  "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0,
  "lockedUntil" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Session" (
  "id" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "userAgent" TEXT,
  "ipAddress" TEXT,
  CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "User_nationalId_key" ON "User"("nationalId");
CREATE UNIQUE INDEX "User_personnelId_key" ON "User"("personnelId");
CREATE INDEX "User_departmentId_hasResetRequest_idx" ON "User"("departmentId", "hasResetRequest");
CREATE INDEX "User_role_active_idx" ON "User"("role", "active");
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");
CREATE INDEX "Session_userId_idx" ON "Session"("userId");
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
