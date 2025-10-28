import { render, screen, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuthButton } from "@/components/auth/AuthButton";
import { useAuthStore } from "@/lib/auth-store";

let mockPathname = "/";
let mockSearch = new URLSearchParams();

vi.mock("next/navigation", async () => {
  const actual = await vi.importActual<typeof import("next/navigation")>("next/navigation");
  return {
    ...actual,
    usePathname: () => mockPathname,
    useSearchParams: () => mockSearch,
  };
});

vi.mock("next-auth/react", () => ({
  signOut: vi.fn(),
}));

const resetStore = () => {
  act(() => {
    useAuthStore.setState({
      status: "unauthenticated",
      user: undefined,
      accessToken: undefined,
      expiresAt: undefined,
    });
  });
};

describe("AuthButton", () => {
  beforeEach(() => {
    mockPathname = "/";
    mockSearch = new URLSearchParams();
    resetStore();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("links to login when unauthenticated", () => {
    render(<AuthButton />);

    const link = screen.getByRole("link", { name: /sign in/i });
    expect(link).toBeInTheDocument();
  expect(link).toHaveAttribute("href", "/login?next=%2F");
  });

  it("includes next param with current location", () => {
    mockPathname = "/products";
    mockSearch = new URLSearchParams("category=laptops");

    render(<AuthButton />);

    const link = screen.getByRole("link", { name: /sign in/i });
    expect(link).toHaveAttribute("href", "/login?next=%2Fproducts%3Fcategory%3Dlaptops");
  });

  it("renders user details when authenticated", () => {
    act(() => {
      useAuthStore.setState({
        status: "authenticated",
        user: {
          id: "123",
          name: "Ada Lovelace",
          email: "ada@example.com",
          role: "admin",
          image: null,
        },
        accessToken: "token",
        expiresAt: Date.now() + 10_000,
      });
    });

    render(<AuthButton />);

    expect(screen.getByText(/Ada Lovelace/)).toBeInTheDocument();
    expect(screen.getByText(/admin/i)).toBeInTheDocument();
  });
});
