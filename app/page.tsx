import Link from 'next/link';

const FEATURES = [
  {
    emoji: '🎨',
    title: 'Design like paper',
    text: 'Drag, rotate and restyle every note, photo and sticker — it feels like a real scrapbook.',
  },
  {
    emoji: '📷',
    title: 'Photos, audio & links',
    text: 'Attach the things that matter: pictures, voice notes, videos and links to remember.',
  },
  {
    emoji: '🔒',
    title: 'Private by default',
    text: 'Your journals are yours. Keep them private or share a public link when you like.',
  },
];

export default function LandingPage() {
  return (
    <main className="flex min-h-screen flex-col bg-[#FFF7F8] px-4 text-[#111111] sm:px-6">
      {/* Nav */}
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between py-4">
        <span className="text-lg font-extrabold tracking-tight">enotes</span>
        <Link
          href="/auth/sign-in"
          className="rounded-xl border border-black px-4 py-2 text-sm font-medium transition hover:bg-black/5"
        >
          Sign in
        </Link>
      </header>

      {/* Hero */}
      <section className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center py-12 text-center sm:py-16">
        <h1 className="text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl md:text-6xl">
          Your thoughts deserve a place that feels like you.
        </h1>
        <p className="mt-4 max-w-xl text-base text-[#6B6B6B] sm:text-lg">
          An artistic, interactive journal for notes, memories and little pieces of life —
          beautiful on your desk and in your pocket.
        </p>

        <div className="mt-8 flex w-full flex-col gap-3 px-2 sm:w-auto sm:flex-row sm:justify-center sm:gap-4 sm:px-0">
          <Link
            href="/auth/sign-up"
            className="rounded-xl bg-black px-8 py-3.5 text-center font-medium text-[#FFB6C1] shadow transition hover:opacity-90"
          >
            Start journaling
          </Link>
          <Link
            href="/auth/sign-in"
            className="rounded-xl border border-black px-8 py-3.5 text-center font-medium transition hover:bg-black/5"
          >
            Sign in
          </Link>
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto grid w-full max-w-5xl grid-cols-1 gap-4 pb-14 sm:grid-cols-3 sm:gap-5">
        {FEATURES.map((feature) => (
          <div
            key={feature.title}
            className="rounded-2xl border border-[#E8E2E4] bg-white p-5 shadow-sm"
          >
            <div className="text-2xl">{feature.emoji}</div>
            <h2 className="mt-3 font-semibold">{feature.title}</h2>
            <p className="mt-1 text-sm leading-relaxed text-[#6B6B6B]">{feature.text}</p>
          </div>
        ))}
      </section>

      <footer className="border-t border-[#E8E2E4] py-5 text-center text-xs text-[#9B9B9B]">
        <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
          <Link href="/privacy" className="underline transition hover:text-[#111111]">Privacy Policy</Link>
          <Link href="/terms" className="underline transition hover:text-[#111111]">Terms of Service</Link>
          <Link href="/contact" className="underline transition hover:text-[#111111]">Contact</Link>
        </div>
        <p className="mt-2">enotes — write it down, keep it close.</p>
      </footer>
    </main>
  );
}
