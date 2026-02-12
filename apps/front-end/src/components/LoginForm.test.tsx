import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import LoginForm from "./LoginForm";

describe("LoginForm", () => {
  it("submits username/password", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<LoginForm loading={false} errorMessage={null} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByLabelText("Username"), {
      target: { value: "viewer" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "viewer123" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(onSubmit).toHaveBeenCalledWith("viewer", "viewer123");
  });
});
