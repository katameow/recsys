"use client";

import { useEffect, useMemo, useState } from "react";
import { signIn, getProviders } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Loader2, LogIn, UserRound } from "lucide-react";

import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { useAuthStore } from "@/lib/auth-store";
import { requestGuestSession } from "@/lib/guest-auth";
import { sanitizeRedirectPath } from "@/lib/navigation";

interface LoginCardProps {
  nextPath: string;
}

const PROVIDER_ORDER = ["google", "github", "azure-ad"];

type ProviderMap = NonNullable<Awaited<ReturnType<typeof getProviders>>>;
type AuthProvider = ProviderMap[keyof ProviderMap];
type SignInResult = Awaited<ReturnType<typeof signIn>>;

const sortProviders = (providers: AuthProvider[]) => {
  return providers.sort((a, b) => {
    const indexA = PROVIDER_ORDER.indexOf(a.id);
    const indexB = PROVIDER_ORDER.indexOf(b.id);

    if (indexA === -1 && indexB === -1) {
      return a.name.localeCompare(b.name);
    }

    if (indexA === -1) return 1;
    if (indexB === -1) return -1;
    return indexA - indexB;
  });
};

export function LoginCard({ nextPath }: LoginCardProps) {
  const router = useRouter();
  const [providers, setProviders] = useState<AuthProvider[]>([]);
  const [providersLoading, setProvidersLoading] = useState(true);
  const [guestLoading, setGuestLoading] = useState(false);
  const login = useAuthStore((state) => state.login);
  const setLoading = useAuthStore((state) => state.setLoading);
  const safeNextPath = useMemo(() => sanitizeRedirectPath(nextPath), [nextPath]);

  useEffect(() => {
    let cancelled = false;

    const loadProviders = async () => {
      try {
        const fetched = await getProviders();
        if (!cancelled && fetched) {
          setProviders(sortProviders(Object.values(fetched)));
        }
      } catch {
        if (!cancelled) {
          toast({
            title: "Unable to load providers",
            description: "Please refresh the page or try again later.",
            variant: "destructive",
          });
        }
      } finally {
        if (!cancelled) {
          setProvidersLoading(false);
        }
      }
    };

    loadProviders();
    return () => {
      cancelled = true;
    };
  }, []);

  const hasProviders = providers.length > 0;

  const handleProviderSignIn = async (providerId: string) => {
    try {
      setLoading(true);
      const response = (await signIn(providerId, {
        callbackUrl: safeNextPath,
        redirect: true,
      })) as unknown as SignInResult | undefined;

      if (response && typeof response === "object" && "error" in response && response.error) {
        toast({
          title: "Sign-in failed",
          description: String(response.error),
          variant: "destructive",
        });
        setLoading(false);
      }
    } catch (error) {
      const message =
        error && typeof error === "object" && "message" in (error as Record<string, unknown>)
          ? String((error as { message?: unknown }).message ?? "Unexpected error during sign-in")
          : "Unexpected error during sign-in";

      toast({
        title: "Unable to sign in",
        description: message,
        variant: "destructive",
      });
      setLoading(false);
    }
  };

  const handleGuestAccess = async () => {
    try {
      setGuestLoading(true);
      setLoading(true);
      const session = await requestGuestSession();

      login({
        user: session.user,
        accessToken: session.accessToken,
        expiresAt: session.expiresAt,
      });

      router.push(safeNextPath);
      router.refresh();
      toast({
        title: "Guest access enabled",
        description: "You can explore the catalogue with limited capabilities.",
      });
    } catch (error) {
      const message =
        error && typeof error === "object" && "message" in (error as Record<string, unknown>)
          ? String((error as { message?: unknown }).message ?? "Failed to issue guest token")
          : "Failed to issue guest token";

      toast({
        title: "Guest access failed",
        description: message,
        variant: "destructive",
      });
    } finally {
      setGuestLoading(false);
      setLoading(false);
    }
  };

  return (
    <Card className="w-full max-w-md border-muted-foreground/10 shadow-lg backdrop-blur">
      <CardHeader>
        <CardTitle className="text-3xl font-semibold">Sign in to MegaMart</CardTitle>
        <CardDescription>
          Choose your preferred identity provider or continue as a guest for a limited experience.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {providersLoading && (
          <div className="flex items-center justify-center rounded-md border border-dashed py-6 text-muted-foreground">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            Loading providers…
          </div>
        )}

        {!providersLoading && !hasProviders && (
          <p className="rounded-md border border-yellow-500/40 bg-yellow-500/10 p-4 text-sm text-yellow-900 dark:text-yellow-100">
            No OAuth providers are currently configured. Please contact an administrator to enable sign-in.
          </p>
        )}

        {providers.map((provider) => (
          <Button
            key={provider.id}
            variant="outline"
            className="w-full justify-between"
            onClick={() => handleProviderSignIn(provider.id)}
            disabled={guestLoading || providersLoading}
          >
            <span className="flex items-center gap-2">
              <LogIn className="h-4 w-4" />
              Sign in with {provider.name}
            </span>
          </Button>
        ))}

        <div className="relative py-2 text-center text-xs uppercase tracking-wide text-muted-foreground">
          <span className="bg-background px-3">or</span>
          <div className="absolute inset-x-0 top-1/2 -z-10 h-px bg-border" />
        </div>

        <Button
          variant="secondary"
          className="w-full"
          onClick={handleGuestAccess}
          disabled={guestLoading || providersLoading}
        >
          {guestLoading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Issuing guest token…
            </>
          ) : (
            <>
              <UserRound className="h-4 w-4" />
              Continue as guest
            </>
          )}
        </Button>
      </CardContent>
      <CardFooter className="flex-col items-start space-y-2 text-sm text-muted-foreground">
        <p>
          Guest sessions last for a short duration and have stricter rate limits. Sign in to lift usage restrictions and
          access personalized recommendations.
        </p>
        <p>
          By continuing, you agree to MegaMart&apos;s acceptable use policy and understand that activity may be monitored for
          abuse prevention.
        </p>
      </CardFooter>
    </Card>
  );
}
