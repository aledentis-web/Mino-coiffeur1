import type { Metadata } from "next";
import { BookingProvider } from "./components/booking-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Studio Barber 8 — Business Test",
  description:
    "Agenda elettronica e segretario digitale multicanale per barber shop."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="it">
      <body>
        <BookingProvider>{children}</BookingProvider>
      </body>
    </html>
  );
}
