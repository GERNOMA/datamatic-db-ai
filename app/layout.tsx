import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Datamatic — Conversa con tus datos",
  description:
    "Explora tu base de datos MySQL en español. Añade contexto, elige tus tablas y obtén respuestas de solo lectura.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
