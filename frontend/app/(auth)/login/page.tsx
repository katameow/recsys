import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { LoginForm } from "@/components/auth/LoginForm";
import { TestimonialSection } from "@/components/auth/TestimonialSection";
import { auth } from "@/app/api/auth/[...nextauth]/route";
import { DEFAULT_AUTH_REDIRECT, sanitizeRedirectPath } from "@/lib/navigation";

export const metadata: Metadata = {
  title: "Sign in | Katalyst",
  description:
    "Sign in to test out our product search functionality",
};

interface LoginPageProps {
  searchParams?: Record<string, string | string[] | undefined>;
}

const resolveNextPath = (rawNext?: string | string[] | undefined) => {
  if (!rawNext) return DEFAULT_AUTH_REDIRECT;
  const nextCandidate = Array.isArray(rawNext) ? rawNext[0] : rawNext;
  return sanitizeRedirectPath(nextCandidate);
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const session = await auth();
  // According to Next.js app router rules, `searchParams` may be a promise-like
  // value in some environments. Await it before using its properties.
  const params = await searchParams;
  const nextPath = resolveNextPath(params?.next ?? params?.callbackUrl);

  if (session?.user) {
    redirect(nextPath);
  }

  return (
    <div className="min-h-screen bg-gray-50 flex">
      {/* Left side - Testimonial */}
      <div className="flex-1 bg-gradient-to-br from-teal-600 to-teal-800">
        <TestimonialSection />
      </div>
      
      {/* Right side - Login Form */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-md">
          <LoginForm />
        </div>
      </div>
    </div>
  );
}