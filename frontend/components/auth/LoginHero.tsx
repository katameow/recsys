import Image from "next/image";

export function LoginHero() {
  return (
    <div className="relative flex w-full flex-1 items-center justify-center overflow-hidden rounded-3xl border border-muted-foreground/10 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-8 shadow-2xl">
      <div className="absolute inset-0 opacity-40">
        <Image
          src="/placeholder.jpg"
          alt="MegaMart shoppers browsing curated recommendations"
          fill
          className="object-cover object-center"
          priority
        />
      </div>

      <div className="relative z-10 mx-auto flex max-w-lg flex-col space-y-6 text-left text-slate-50">
        <span className="inline-flex w-fit items-center rounded-full border border-slate-200/20 bg-slate-900/70 px-3 py-1 text-xs font-medium uppercase tracking-wide text-slate-200">
          Powered by Open Retail Intelligence
        </span>
        <h1 className="text-4xl font-bold leading-tight md:text-5xl">The smartest way to discover tech that fits</h1>
        <p className="text-base text-slate-200/90 md:text-lg">
          MegaMart&apos;s adaptive recommender blends LLM-driven expertise with real shopper insights to surface the ideal
          devices for your needs. Sign in to sync preferences or explore as a guest to try it hands-on.
        </p>
        <ul className="space-y-2 text-sm text-slate-200/80 md:text-base">
          <li className="flex items-start gap-2">
            <span className="mt-1 h-2 w-2 flex-shrink-0 rounded-full bg-emerald-400" />
            Hyper-personalized product comparisons and spec breakdowns
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-1 h-2 w-2 flex-shrink-0 rounded-full bg-emerald-400" />
            Real-time Q&A with sourcing from trusted retail experts
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-1 h-2 w-2 flex-shrink-0 rounded-full bg-emerald-400" />
            Save shortlists, sync sessions, and unlock AI-enhanced insights
          </li>
        </ul>
      </div>

      <div className="pointer-events-none absolute inset-0 ">
        <div className="absolute -left-24 -top-24 h-64 w-64 rounded-full bg-emerald-400/30 blur-3xl" />
        <div className="absolute bottom-0 right-0 h-72 w-72 rounded-full bg-sky-500/30 blur-3xl" />
      </div>
    </div>
  );
}
