import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Datamatic — Chat with your data",
  description:
    "Explore your MySQL database in plain English. Add context, choose your tables, and get read-only answers.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
