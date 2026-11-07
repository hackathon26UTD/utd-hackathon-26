import type { Metadata } from "next";
import "./globals.css";
import "./polish.css";
export const metadata: Metadata = {
  title: "FutureYou — Make room for what’s next",
  description:
    "Explore how a summer internship changes your cash flow. Compare scenarios, understand the timing, and make a plan with a little more breathing room.",
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
