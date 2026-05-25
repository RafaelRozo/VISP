import Logo from '@/components/Logo';

/**
 * Stripe Connect onboarding "return" URL.
 *
 * Stripe redirects the provider here after they finish (or close) the
 * hosted onboarding flow. Mobile users are deep-linked back to the app
 * with `visptasker://stripe-connect-return`. This web page exists for
 * the rare case Stripe falls back to an HTTP URL or for desktop testers.
 */
export default function StripeReturn() {
  return (
    <div className="min-h-screen grid place-items-center px-6 text-center">
      <div className="glass max-w-md p-10">
        <Logo size={56} className="mx-auto mb-5" />
        <h1 className="text-2xl font-bold mb-2">All done</h1>
        <p className="text-textSecondary leading-relaxed">
          You can close this window and return to the VISP app to confirm the
          status of your payouts.
        </p>
      </div>
    </div>
  );
}
