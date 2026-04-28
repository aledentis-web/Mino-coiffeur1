import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mino Coiffeur — Demo prenotazioni",
  description: "Demo navigabile per simulare richieste di prenotazione da Mino Coiffeur."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="it">
      <body>{children}</body>
    </html>
  );
}
