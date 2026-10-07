-- DropTable
DROP TABLE "web_locale_preferences";

-- CreateTable
CREATE TABLE "dashboard_admins" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dashboard_admins_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "dashboard_admins_username_key" ON "dashboard_admins"("username");

-- CreateTable
CREATE TABLE "web_locale_preferences" (
    "adminId" TEXT NOT NULL,
    "language" "SupportedLanguage" NOT NULL,
    "isExplicit" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "web_locale_preferences_pkey" PRIMARY KEY ("adminId")
);

-- AddForeignKey
ALTER TABLE "web_locale_preferences" ADD CONSTRAINT "web_locale_preferences_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "dashboard_admins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
