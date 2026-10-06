-- CreateTable
CREATE TABLE "web_locale_preferences" (
    "userId" TEXT NOT NULL,
    "language" "SupportedLanguage" NOT NULL,
    "isExplicit" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "web_locale_preferences_pkey" PRIMARY KEY ("userId")
);

-- AddForeignKey
ALTER TABLE "web_locale_preferences" ADD CONSTRAINT "web_locale_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
