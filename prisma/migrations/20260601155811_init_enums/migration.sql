-- CreateEnum
CREATE TYPE "Locale" AS ENUM ('EN', 'TW', 'EE', 'DA');

-- CreateEnum
CREATE TYPE "VerificationTier" AS ENUM ('T0', 'T1', 'T2', 'T3', 'T4');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'BANNED');

-- CreateEnum
CREATE TYPE "Currency" AS ENUM ('GHS', 'USD', 'GBP', 'EUR');
