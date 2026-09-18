import type { Metadata } from 'next';
import Link from 'next/link';
import { SITE } from '@/lib/site';

export const metadata: Metadata = {
  title: `Terms of Service — ${SITE.name}`,
  description: `The rules for using ${SITE.name}.`,
};

export default function TermsPage() {
  return (
    <main className="min-h-[100dvh] bg-[#FFF7F8] px-4 py-8 text-[#111111] sm:px-6">
      <div className="mx-auto max-w-2xl">
        <h1 className="text-3xl font-bold tracking-tight">Terms of Service</h1>
        <p className="mt-1 text-sm text-[#6B6B6B]">Last updated: {SITE.legalUpdated}</p>

        <div className="mt-6 space-y-6 rounded-2xl border border-[#E8E2E4] bg-white p-5 text-sm leading-relaxed shadow-sm sm:p-7">
          <section>
            <h2 className="text-lg font-bold">1. Accepting these terms</h2>
            <p className="mt-2 text-[#3D3D3D]">
              By creating an account or using {SITE.name}, you agree to these Terms of Service and to
              our{' '}
              <Link className="font-semibold text-[#E5798F] underline" href="/privacy">
                Privacy Policy
              </Link>
              . If you do not agree, please do not use the service.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold">2. Your account</h2>
            <p className="mt-2 text-[#3D3D3D]">
              You must be at least 13 years old (16 in the EEA). You are responsible for keeping your
              password safe and for everything that happens under your account. You may delete your
              account at any time from Settings → Profile.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold">3. Your content</h2>
            <p className="mt-2 text-[#3D3D3D]">
              You keep ownership of everything you write and upload. To run the service, you grant us
              a limited, worldwide, royalty-free license to store, display, and transmit your content
              to you and the people you choose to share it with. This license ends when you delete
              the content or your account. You are responsible for making sure you have the rights to
              what you upload.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold">4. Acceptable use</h2>
            <p className="mt-2 text-[#3D3D3D]">You agree <b>not</b> to:</p>
            <ul className="mt-2 list-disc space-y-1.5 pl-5 text-[#3D3D3D]">
              <li>harass, bully, threaten, or impersonate other users;</li>
              <li>post illegal content, sexual content involving minors, or credible threats of violence;</li>
              <li>post other people&apos;s private information without their consent (doxxing);</li>
              <li>spam, scam, phish, or use bots to artificially inflate follows, likes, or views;</li>
              <li>attempt to access accounts, journals, or messages that are not yours;</li>
              <li>scrape, reverse-engineer, or overload the service, or bypass its security rules.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-bold">5. Moderation and enforcement</h2>
            <p className="mt-2 text-[#3D3D3D]">
              We may review reported content, remove violating material, limit features, or suspend
              accounts that break these rules. You can report content or users to{' '}
              <a className="font-semibold text-[#E5798F] underline" href={`mailto:${SITE.abuseEmail}`}>
                {SITE.abuseEmail}
              </a>{' '}
              or through the app. If we take action on your account, we will tell you why where the
              law allows, and you can appeal to{' '}
              <a className="font-semibold text-[#E5798F] underline" href={`mailto:${SITE.contactEmail}`}>
                {SITE.contactEmail}
              </a>
              .
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold">6. Availability</h2>
            <p className="mt-2 text-[#3D3D3D]">
              The service is provided &ldquo;as is&rdquo; and &ldquo;as available.&rdquo; We work hard
              to keep {SITE.name} running, but we do not promise it will be uninterrupted or
              error-free, and we may change or discontinue features. Keep your own backup of anything
              you would be heartbroken to lose.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold">7. Limitation of liability</h2>
            <p className="mt-2 text-[#3D3D3D]">
              To the fullest extent permitted by law, {SITE.operator} is not liable for indirect,
              incidental, special, consequential, or punitive damages, or for lost profits, data, or
              goodwill, arising from your use of the service. Our total liability for any claim is
              limited to the greater of the amount you paid us in the last 12 months (typically zero
              — the service is free) or USD 50.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold">8. Termination</h2>
            <p className="mt-2 text-[#3D3D3D]">
              You can stop using the service at any time. We may suspend or terminate accounts that
              violate these terms or that we are legally required to act on. Sections 3, 6, 7 and 9
              survive termination.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold">9. Governing law &amp; disputes</h2>
            <p className="mt-2 text-[#3D3D3D]">
              These terms are governed by the laws of the country or state where {SITE.operator} is
              established, without regard to conflict-of-law rules. Before filing suit, please email
              us — most problems are solved with a conversation.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold">10. Changes</h2>
            <p className="mt-2 text-[#3D3D3D]">
              We may update these terms. For material changes we will notify you in the app in
              advance. Continuing to use {SITE.name} after a change means you accept the updated
              terms.
            </p>
          </section>
        </div>

        <p className="mt-6 text-center text-sm text-[#6B6B6B]">
          <Link href="/" className="font-semibold underline">← Back to {SITE.name}</Link>
          <span className="mx-2">·</span>
          <Link href="/privacy" className="font-semibold underline">Privacy Policy</Link>
          <span className="mx-2">·</span>
          <Link href="/contact" className="font-semibold underline">Contact</Link>
        </p>
      </div>
    </main>
  );
}
