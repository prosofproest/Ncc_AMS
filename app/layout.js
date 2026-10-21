import './globals.css';

export const metadata = {
  title: 'NCC AIRWING · FLIGHT-B · Attendance',
  description: 'AMS — NCC Airwing Flight-B, 6 KAR AIR SQN NCC',
  manifest: '/manifest.json',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'NCC AMS' },
};
export const viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: [{ media: '(prefers-color-scheme: light)', color: '#E8EFFC' }, { media: '(prefers-color-scheme: dark)', color: '#0B1020' }] };

// Applies the saved (or system) theme before first paint so there is no white flash.
const themeScript = `try{var t=localStorage.getItem('ncc_theme');if(!t)t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';document.documentElement.setAttribute('data-theme',t)}catch(e){}`;

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <link rel="apple-touch-icon" href="/icon-192.png" />
      </head>
      <body>{children}</body>
    </html>
  );
}
