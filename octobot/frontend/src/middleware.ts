import createMiddleware from "next-intl/middleware";
import { NextResponse, type NextRequest } from "next/server";
import { routing } from "./i18n/routing";

const handleI18n = createMiddleware(routing);

const DASHBOARD_PREFIXES = [
  "/overview",
  "/users",
  "/bots",
  "/channels",
  "/publishing",
  "/catalog",
  "/broadcast",
  "/audit",
];

export default function middleware(request: NextRequest) {
  const match = request.nextUrl.pathname.match(/^\/(ar|en)(\/.*)?$/);
  if (match) {
    const rest = match[2] ?? "";
    const protectedPath = DASHBOARD_PREFIXES.some(
      (prefix) => rest === prefix || rest.startsWith(`${prefix}/`),
    );
    const session = request.cookies.get("octobot_admin_session")?.value;
    if (protectedPath && !session) {
      return NextResponse.redirect(new URL(`/${match[1]}`, request.url));
    }
  }
  return handleI18n(request);
}

export const config = {
  matcher: ["/((?!admin-api|_next|.*\\..*).*)"],
};
