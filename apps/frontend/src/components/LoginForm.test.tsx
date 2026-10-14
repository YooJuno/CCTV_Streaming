import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import LoginForm from "./LoginForm";

describe("LoginForm", () => {
  afterEach(cleanup);
  it("submits the trimmed username and unchanged password", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <LoginForm loading={false} errorMessage={null} onSubmit={onSubmit} />,
    );
    fireEvent.change(screen.getByLabelText("아이디"), {
      target: { value: " viewer " },
    });
    fireEvent.change(screen.getByLabelText("비밀번호", { exact: true }), {
      target: { value: " viewer123 " },
    });
    fireEvent.click(screen.getByRole("button", { name: /관제 시작하기/ }));
    expect(onSubmit).toHaveBeenCalledWith("viewer", " viewer123 ");
  });

  it("toggles password visibility without changing its value", () => {
    render(
      <LoginForm loading={false} errorMessage={null} onSubmit={vi.fn()} />,
    );
    const password = screen.getByLabelText("비밀번호", { exact: true });
    fireEvent.change(password, { target: { value: "secret" } });
    expect(password).toHaveAttribute("type", "password");
    fireEvent.click(screen.getByRole("button", { name: "비밀번호 보기" }));
    expect(password).toHaveAttribute("type", "text");
    expect(password).toHaveValue("secret");
    fireEvent.click(screen.getByRole("button", { name: "비밀번호 숨기기" }));
    expect(password).toHaveAttribute("type", "password");
  });

  it("blocks blank usernames and announces a login failure", () => {
    render(
      <LoginForm
        loading={false}
        errorMessage="아이디 또는 비밀번호를 확인하세요."
        onSubmit={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("아이디"), {
      target: { value: "  " },
    });
    fireEvent.change(screen.getByLabelText("비밀번호", { exact: true }), {
      target: { value: "secret" },
    });
    expect(
      screen.getByRole("button", { name: /관제 시작하기/ }),
    ).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("아이디 또는 비밀번호");
  });
});
