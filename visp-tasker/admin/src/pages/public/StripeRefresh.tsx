import Logo from '@/components/Logo';

/**
 * Stripe Connect onboarding "refresh" URL — hit when the link expires.
 * Tells the user to go back to the VISP app and try again.
 */
export default function StripeRefresh() {
  return (
    <div className="min-h-screen grid place-items-center px-6 text-center">
      <div className="glass max-w-md p-10">
        <Logo size={56} className="mx-auto mb-5" />
        <h1 className="text-2xl font-bold mb-2">Link expired</h1>
        <p className="text-textSecondary leading-relaxed">
          Please return to the VISP app and tap "Set Up Payments" again to
          continue.
        </p>
      </div>
    </div>
  );
}
