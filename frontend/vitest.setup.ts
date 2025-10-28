import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";
import React from "react";
import type { AnchorHTMLAttributes, DetailedHTMLProps } from "react";

vi.mock("next/link", () => ({
  __esModule: true,
  default: ({ href, children, ...props }: DetailedHTMLProps<AnchorHTMLAttributes<HTMLAnchorElement>, HTMLAnchorElement>) => {
    const resolvedHref =
      typeof href === "string"
        ? href
        : typeof href === "object" && href !== null && "pathname" in href
        ? String((href as { pathname?: string }).pathname ?? "")
        : String(href);

    return React.createElement(
      "a",
      {
        href: resolvedHref,
        ...props,
      },
      children
    );
  },
}));

vi.mock("next/image", () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => React.createElement("img", props),
}));
