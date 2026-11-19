import { Analytics } from '@vercel/analytics/next';

export const metadata = {
  title: 'Dink 65 Line Bot',
  description: 'LINE bot for Dink 65 Pickleball Club',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="th">
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
