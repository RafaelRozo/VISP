/**
 * VISP - Payment Methods Screen
 *
 * Lists saved payment methods from Stripe, shows card brand/last4/expiry,
 * default method indicator, and an "Add Payment Method" flow.
 *
 * Add card flow:
 *   1. Backend creates a SetupIntent + Stripe customer (POST /users/me/payment-setup-intent)
 *   2. Stripe CardForm collects: card number, expiry, CVC, postal code
 *   3. confirmSetupIntent() sends card data securely to Stripe via the SDK
 *   4. Card is saved to the customer automatically
 *
 * Dark glassmorphism redesign.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { CardForm, useConfirmSetupIntent } from '@stripe/stripe-react-native';
import { Colors } from '../../theme/colors';
import { useTheme } from '../../theme/ThemeContext';
import { GlassCard, GlassButton } from '../../components/glass';
import { Screen } from '../../components/visp';
import { AnimatedSpinner } from '../../components/animations';
import { useAuthStore } from '../../stores/authStore';
import { post } from '../../services/apiClient';
import {
  paymentService,
  PaymentMethodInfo,
} from '../../services/paymentService';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BRAND_DISPLAY: Record<string, string> = {
  visa: 'Visa',
  mastercard: 'Mastercard',
  amex: 'American Express',
  discover: 'Discover',
  diners: 'Diners Club',
  jcb: 'JCB',
  unionpay: 'UnionPay',
};

function brandLabel(brand: string): string {
  return BRAND_DISPLAY[brand.toLowerCase()] ?? brand.charAt(0).toUpperCase() + brand.slice(1);
}

// ---------------------------------------------------------------------------
// Card Item
// ---------------------------------------------------------------------------

interface CardItemProps {
  method: PaymentMethodInfo;
  isDefault: boolean;
  onRemove: (method: PaymentMethodInfo) => void;
}

function CardItem({ method, isDefault, onRemove }: CardItemProps): React.JSX.Element {
  const theme = useTheme();
  return (
    <GlassCard variant="standard" style={cardStyles.cardMargin}>
      <View style={cardStyles.container}>
        {/* Brand icon chip */}
        <View style={cardStyles.iconContainer}>
          <Text style={cardStyles.iconText}>
            {method.brand.toLowerCase() === 'visa' ? 'V' : method.brand.charAt(0).toUpperCase()}
          </Text>
        </View>

        {/* Card details */}
        <View style={cardStyles.info}>
          <View style={cardStyles.topRow}>
            <Text style={[cardStyles.brand, { color: theme.textPrimary }]}>{brandLabel(method.brand)}</Text>
            {isDefault && (
              <View style={cardStyles.defaultBadge}>
                <Text style={cardStyles.defaultText}>Default</Text>
              </View>
            )}
          </View>
          <Text style={[cardStyles.last4, { color: theme.textSecondary }]}>**** **** **** {method.last4}</Text>
          <Text style={[cardStyles.expiry, { color: theme.textTertiary }]}>
            Expires {String(method.exp_month).padStart(2, '0')}/{method.exp_year}
          </Text>
        </View>
      </View>

      {/* Remove action */}
      <View style={cardStyles.actions}>
        <GlassButton
          title="Remove"
          variant="outline"
          onPress={() => onRemove(method)}
          style={cardStyles.removeButton}
        />
      </View>
    </GlassCard>
  );
}

const cardStyles = StyleSheet.create({
  cardMargin: {
    marginBottom: 12,
  },
  container: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconContainer: {
    width: 48,
    height: 34,
    borderRadius: 10,
    backgroundColor: 'rgba(120, 80, 255, 0.20)',
    borderWidth: 1,
    borderColor: 'rgba(120, 80, 255, 0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
    ...Platform.select({
      ios: {
        shadowColor: 'rgba(120, 80, 255, 0.4)',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.5,
        shadowRadius: 6,
      },
      android: { elevation: 2 },
    }),
  },
  iconText: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.primary,
  },
  info: {
    flex: 1,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  brand: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  defaultBadge: {
    marginLeft: 8,
    backgroundColor: `${Colors.success}20`,
    borderWidth: 1,
    borderColor: `${Colors.success}40`,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    ...Platform.select({
      ios: {
        shadowColor: Colors.success,
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 0.3,
        shadowRadius: 6,
      },
      android: { elevation: 2 },
    }),
  },
  defaultText: {
    fontSize: 10,
    fontWeight: '700',
    color: Colors.success,
    textTransform: 'uppercase',
  },
  last4: {
    fontSize: 14,
    fontWeight: '500',
    color: 'rgba(255, 255, 255, 0.55)',
    letterSpacing: 2,
    marginBottom: 2,
  },
  expiry: {
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.35)',
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.glassBorder.subtle,
  },
  removeButton: {
    paddingVertical: 8,
    paddingHorizontal: 20,
    minHeight: 36,
    borderColor: `${Colors.emergencyRed}40`,
  },
});

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function PaymentMethodsScreen(): React.JSX.Element {
  const theme = useTheme();
  const stripeCustomerId = useAuthStore((s) => s.user?.stripeCustomerId);
  const [methods, setMethods] = useState<PaymentMethodInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showAddCard, setShowAddCard] = useState(false);
  const [cardFormComplete, setCardFormComplete] = useState(false);
  const [isSavingCard, setIsSavingCard] = useState(false);
  const { confirmSetupIntent } = useConfirmSetupIntent();

  // -----------------------------------------------------------------------
  // Fetch saved payment methods
  // -----------------------------------------------------------------------

  const fetchMethods = useCallback(async () => {
    if (!stripeCustomerId) {
      setMethods([]);
      setIsLoading(false);
      return;
    }
    try {
      const result = await paymentService.listPaymentMethods(stripeCustomerId);
      setMethods(result.methods ?? []);
    } catch (err) {
      console.warn('[PaymentMethodsScreen] Failed to load methods:', err);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [stripeCustomerId]);

  useEffect(() => {
    fetchMethods();
  }, [fetchMethods]);

  const handleRefresh = useCallback(() => {
    setIsRefreshing(true);
    fetchMethods();
  }, [fetchMethods]);

  // -----------------------------------------------------------------------
  // Save card via Stripe SetupIntent flow
  //
  // 1. POST /users/me/payment-setup-intent → { clientSecret, customerId }
  // 2. confirmSetupIntent(clientSecret) → Stripe SDK sends card from CardForm
  // 3. Card is attached to customer automatically by Stripe
  // -----------------------------------------------------------------------

  const handleSaveCard = useCallback(async () => {
    if (!cardFormComplete) {
      Alert.alert('Incomplete', 'Please fill in all card fields.');
      return;
    }
    setIsSavingCard(true);

    try {
      // Step 1: Get SetupIntent + ensure Stripe customer exists
      const response = await post<{
        data: {
          clientSecret: string;
          customerId: string;
          setupIntentId: string;
        };
      }>('/users/me/payment-setup-intent', {});

      const setupData = response?.data ?? response;
      const clientSecret = (setupData as any)?.clientSecret;
      const customerId = (setupData as any)?.customerId;

      if (!clientSecret) {
        Alert.alert('Error', 'Could not initialize card setup. Please try again.');
        return;
      }

      // Update local user with Stripe customer ID
      if (customerId) {
        const currentUser = useAuthStore.getState().user;
        if (currentUser && currentUser.stripeCustomerId !== customerId) {
          useAuthStore.getState().setUser({
            ...currentUser,
            stripeCustomerId: customerId,
          });
        }
      }

      // Step 2: Confirm SetupIntent — Stripe SDK reads card data from CardForm
      const { setupIntent, error } = await confirmSetupIntent(clientSecret, {
        paymentMethodType: 'Card',
      });

      if (error) {
        throw new Error(error.message);
      }

      // Step 3: Done — card is now attached to customer in Stripe
      Alert.alert('Success', 'Card added successfully.');
      setShowAddCard(false);
      setCardFormComplete(false);
      fetchMethods();
    } catch (err: any) {
      console.error('[PaymentMethods] Save card error:', err);
      Alert.alert('Error', err?.message ?? 'Failed to save card. Please try again.');
    } finally {
      setIsSavingCard(false);
    }
  }, [cardFormComplete, fetchMethods, confirmSetupIntent]);

  // -----------------------------------------------------------------------
  // Remove card
  // -----------------------------------------------------------------------

  const handleRemovePaymentMethod = useCallback((method: PaymentMethodInfo) => {
    Alert.alert(
      'Remove Card',
      `Remove ${brandLabel(method.brand)} ending in ${method.last4}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            Alert.alert('Removed', 'Payment method removal will be available with full Stripe integration.');
          },
        },
      ],
    );
  }, []);

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  if (isLoading) {
    return (
      <Screen>
        <View style={styles.center}>
          <AnimatedSpinner size={48} color={Colors.primary} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={handleRefresh}
            tintColor={Colors.primary}
            colors={[Colors.primary]}
          />
        }
      >
        {/* Header */}
        <Text style={[styles.title, { color: theme.textPrimary }]}>
          {showAddCard ? 'Add New Card' : 'Payment Methods'}
        </Text>
        <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
          {showAddCard
            ? 'Enter your card number, expiry, CVC, and postal code'
            : 'Manage your saved cards for booking services.'}
        </Text>

        {!showAddCard && (
          <>
            {methods.length === 0 ? (
              <GlassCard variant="dark" style={styles.emptyCard}>
                <View style={styles.emptyState}>
                  <View style={styles.emptyIconCircle}>
                    <Text style={[styles.emptyIcon, { color: theme.textTertiary }]}>$</Text>
                  </View>
                  <Text style={[styles.emptyTitle, { color: theme.textPrimary }]}>No Payment Methods</Text>
                  <Text style={[styles.emptySubtitle, { color: theme.textSecondary }]}>
                    {stripeCustomerId
                      ? 'You have no saved cards yet. Add one to speed up bookings.'
                      : 'Add a card to get started with VISP services.'}
                  </Text>
                </View>
              </GlassCard>
            ) : (
              <View style={styles.cardsList}>
                {methods.map((method, index) => (
                  <CardItem
                    key={method.id}
                    method={method}
                    isDefault={index === 0}
                    onRemove={handleRemovePaymentMethod}
                  />
                ))}
              </View>
            )}

            <GlassButton
              title="+ Add Payment Method"
              variant="glow"
              onPress={() => setShowAddCard(true)}
              style={styles.addButton}
            />
          </>
        )}

        {showAddCard && (
          <View>
            {/* Stripe CardForm — renders: card number, expiry, CVC, postal code, country */}
            <CardForm
              autofocus
              cardStyle={{
                backgroundColor: '#1A1A2E',
                textColor: '#FFFFFF',
                borderWidth: 1,
                borderColor: 'rgba(120, 80, 255, 0.3)',
                borderRadius: 10,
                fontSize: 16,
                placeholderColor: 'rgba(255, 255, 255, 0.35)',
                cursorColor: '#7850FF',
                textErrorColor: '#E74C3C',
              }}
              style={styles.stripeCardForm}
              onFormComplete={(details) => {
                setCardFormComplete(details.complete);
              }}
            />

            <View style={styles.addCardActions}>
              <GlassButton
                title="Cancel"
                variant="outline"
                onPress={() => {
                  setShowAddCard(false);
                  setCardFormComplete(false);
                }}
                style={styles.actionButton}
              />
              <GlassButton
                title="Save Card"
                variant="glow"
                onPress={handleSaveCard}
                disabled={!cardFormComplete || isSavingCard}
                loading={isSavingCard}
                style={styles.actionButton}
              />
            </View>
          </View>
        )}

        <View style={styles.bottomSpacer} />
      </ScrollView>
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 16,
    paddingTop: 24,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.50)',
    marginBottom: 24,
  },
  cardsList: {
    marginBottom: 16,
  },
  emptyCard: {
    marginBottom: 16,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 32,
  },
  emptyIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: Colors.glass.white,
    borderWidth: 1,
    borderColor: Colors.glassBorder.light,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
    ...Platform.select({
      ios: {
        shadowColor: 'rgba(120, 80, 255, 0.3)',
        shadowOffset: { width: 0, height: 0 },
        shadowOpacity: 1,
        shadowRadius: 12,
      },
      android: { elevation: 4 },
    }),
  },
  emptyIcon: {
    fontSize: 28,
    fontWeight: '700',
    color: 'rgba(255, 255, 255, 0.35)',
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.50)',
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: 16,
  },
  addButton: {
    marginTop: 4,
  },
  // Add card form
  addCardContainer: {
    marginTop: 8,
  },
  addCardTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: 4,
  },
  addCardSubtitle: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.45)',
    marginBottom: 16,
  },
  stripeCardForm: {
    width: '100%',
    height: 240,
    marginBottom: 16,
  },
  addCardActions: {
    flexDirection: 'row',
    gap: 12,
  },
  actionButton: {
    flex: 1,
  },
  bottomSpacer: {
    height: 40,
  },
});
