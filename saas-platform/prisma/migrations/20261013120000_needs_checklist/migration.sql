-- The needs checklist: the two qualifying answers the agent collects on the call
-- (what they need the plot for, and which area they want) and hands to the sales
-- employee. Nullable: a caller can decline, go quiet, or hang up before either
-- question is answered, and the call still closes normally.
--
-- Written for PostgreSQL, which is what schema.prisma declares. The two older
-- migrations in this folder carry SQLite spellings (DATETIME) from the era
-- before the Postgres switch; they are history, not a template.
-- AlterTable
ALTER TABLE "Lead" ADD COLUMN "needPurpose" TEXT;
ALTER TABLE "Lead" ADD COLUMN "needLocality" TEXT;
