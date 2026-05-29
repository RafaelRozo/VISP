/**
 * Shared step → route map for the payouts onboarding wizard.
 * Used by every step screen to advance the user based on the server's
 * `onboardingStep` after a successful submit.
 */

import { PayoutOnboardingStep } from '../../../services/payoutsV2Service';

const STEP_ROUTE: Record<PayoutOnboardingStep, string | null> = {
  init: 'PayoutsPersonalInfo',
  identity: 'PayoutsPersonalInfo',
  tax: 'PayoutsTax',
  bank: 'PayoutsBank',
  identity_doc: 'PayoutsIdentityDoc',
  tos: 'PayoutsTos',
  complete: null,
};

export function advanceToStep(navigation: any, step: PayoutOnboardingStep): void {
  const route = STEP_ROUTE[step];
  if (route) {
    navigation.replace(route);
  } else {
    // Onboarding finished — pop everything back to the Earnings screen.
    navigation.popToTop();
    navigation.goBack();
  }
}
