import { render, screen } from "@testing-library/react";
import App from "./App";

jest.mock("./components/MapView", () => function MockMapView() {
  return <div>Map placeholder</div>;
});

test("renders sign in button", () => {
  render(<App />);
  const button = screen.getByRole("button", { name: /sign in/i });
  expect(button).toBeInTheDocument();
});
