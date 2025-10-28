"use client";

import { ReactNode } from "react";
import { SessionProvider } from "next-auth/react";
import { ThemeProvider } from "@/components/theme-provider";
import { AuthHydrator } from "@/components/auth/AuthHydrator";
import { Toaster } from "@/components/ui/toaster";

interface ProvidersProps {
  children: ReactNode;
}

export function Providers({ children }: ProvidersProps) {
  return (
    <SessionProvider refetchInterval={5 * 60} refetchOnWindowFocus>
      <ThemeProvider
        attribute="class"
        defaultTheme="light"
        enableSystem={false}
        forcedTheme="light"
        storageKey="ui-theme"
        disableTransitionOnChange
      >
        <AuthHydrator />
        {children}
        <Toaster />
      </ThemeProvider>
    </SessionProvider>
  );
}
