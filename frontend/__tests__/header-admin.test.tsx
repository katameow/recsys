import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Header } from "@/components/Header";
import { useAuthStore } from "@/lib/auth-store";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("next/image", () => ({
  __esModule: true,
  default: (props: any) => {
    const { src, alt, ...rest } = props;
    return <img src={src} alt={alt} {...rest} />;
  },
}));

vi.mock("@/components/auth/AuthButton", () => ({
  AuthButton: ({ className }: { className?: string }) => (
    <button type="button" data-testid="auth-button" className={className}>
      Auth
    </button>
  ),
}));

vi.mock("next/link", () => ({
  __esModule: true,
  default: ({ children, href, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const resetStore = () => {
  useAuthStore.setState({
    status: "unauthenticated",
    accessToken: undefined,
    expiresAt: undefined,
    user: undefined,
    refreshCsrf: undefined,
  });
};

describe("Header admin controls", () => {
  const noop = () => undefined;

  beforeEach(() => {
    act(() => {
      resetStore();
    });
  });

  afterEach(() => {
    act(() => {
      resetStore();
    });
  });

  it("renders admin console button when user role is admin", () => {
    act(() => {
      useAuthStore.setState({
        status: "authenticated",
        accessToken: "token",
        expiresAt: Date.now() + 60_000,
        user: { role: "admin", name: "Ada" },
        refreshCsrf: undefined,
      });
      render(<Header onOpenChatbox={noop} onToggleSidebar={noop} />);
    });

  expect(screen.getByRole("link", { name: /admin/i })).toBeInTheDocument();
  });

  it("hides admin console button for non-admin users", () => {
    act(() => {
      useAuthStore.setState({
        status: "authenticated",
        accessToken: "token",
        expiresAt: Date.now() + 60_000,
        user: { role: "guest", name: "Guest" },
        refreshCsrf: undefined,
      });
      render(<Header onOpenChatbox={noop} onToggleSidebar={noop} />);
    });

  expect(screen.queryByRole("link", { name: /admin/i })).not.toBeInTheDocument();
  });
});
