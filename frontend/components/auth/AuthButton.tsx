"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { usePathname, useSearchParams, type ReadonlyURLSearchParams } from "next/navigation";
import { signOut } from "next-auth/react";
import { Loader2, LogIn, LogOut, ShieldCheck } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuthStore } from "@/lib/auth-store";
import { DEFAULT_AUTH_REDIRECT, sanitizeRedirectPath } from "@/lib/navigation";
import { cn } from "@/lib/utils";

const buildNextParam = (
  pathname: string | null,
  search: URLSearchParams | ReadonlyURLSearchParams | null
) => {
  if (!pathname) return DEFAULT_AUTH_REDIRECT;
  const queryString = search?.toString();
  const composed = queryString ? `${pathname}?${queryString}` : pathname;
  return sanitizeRedirectPath(composed);
};

const getInitials = (name?: string | null, email?: string | null) => {
  if (name) {
    const [first = "", second = ""] = name.split(" ");
    const initials = `${first.charAt(0)}${second.charAt(0)}`.trim();
    if (initials) return initials.toUpperCase();
  }
  if (email) {
    return email.charAt(0).toUpperCase();
  }
  return "?";
};

export function AuthButton({ className }: { className?: string }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const nextParam = useMemo(() => buildNextParam(pathname, searchParams), [pathname, searchParams]);

  const status = useAuthStore((state) => state.status);
  const user = useAuthStore((state) => state.user);
  const setLoading = useAuthStore((state) => state.setLoading);
  const logout = useAuthStore((state) => state.logout);
  const [loggingOut, setLoggingOut] = useState(false);

  const loginHref = useMemo(() => `/login?next=${encodeURIComponent(nextParam)}`, [nextParam]);

  if (status === "loading") {
    return (
      <Button variant="ghost" size="icon" className={cn("relative", className)} aria-label="Authenticating">
        <Loader2 className="h-5 w-5 animate-spin" />
      </Button>
    );
  }

  if (status !== "authenticated" || !user) {
    return (
      <Button asChild variant="ghost" className={cn("gap-2 px-3", className)} aria-label="Sign in">
        <Link href={loginHref}>
          <LogIn className="h-4 w-4" />
          <span className="hidden sm:inline">Sign in</span>
        </Link>
      </Button>
    );
  }

  const handleSignOut = async () => {
    try {
      setLoggingOut(true);
      setLoading(true);
      await signOut({ callbackUrl: DEFAULT_AUTH_REDIRECT });
      logout();
    } finally {
      setLoggingOut(false);
      setLoading(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn("gap-2 px-2 sm:px-3", className)}
          aria-label="Account menu"
        >
          <Avatar className="h-8 w-8">
            {user.image ? (
              <AvatarImage src={user.image} alt={user.name ?? user.email ?? "Account avatar"} />
            ) : (
              <AvatarFallback>{getInitials(user.name, user.email)}</AvatarFallback>
            )}
          </Avatar>
          <div className="hidden flex-col items-start sm:flex">
            <span className="text-xs font-semibold leading-none">{user.name ?? user.email ?? "Account"}</span>
            <span className="text-[11px] text-muted-foreground capitalize">{user.role ?? "user"}</span>
          </div>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>
          <div className="flex flex-col">
            <span className="font-medium">{user.name ?? user.email ?? "Signed in"}</span>
            {user.email && <span className="text-xs text-muted-foreground">{user.email}</span>}
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled className="flex items-center gap-2 text-muted-foreground">
          <ShieldCheck className="h-4 w-4" />
          Role: {user.role ?? "user"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="flex items-center gap-2"
          onSelect={(event) => {
            event.preventDefault();
            if (!loggingOut) {
              void handleSignOut();
            }
          }}
        >
          {loggingOut ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
