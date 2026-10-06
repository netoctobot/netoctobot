-- AlterTable
ALTER TABLE "support_list_settings" ALTER COLUMN "listName" SET DEFAULT 'اشترك في القنوات التالية';

-- Existing rows that still have the previous system default have no custom name.
UPDATE "support_list_settings"
SET "listName" = 'اشترك في القنوات التالية'
WHERE "listName" = 'Support list' OR btrim("listName") = '';
