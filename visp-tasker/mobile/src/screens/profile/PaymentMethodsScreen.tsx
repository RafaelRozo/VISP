/**
 * VISP - Payment Methods Screen
 *
 * Lists saved payment methods from Stripe, shows card brand/last4/expiry,
 * default method indicator, and an "Add Payment Method" placeholder.
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
import { Colors } from '../../theme/colors';
import { GlassStyles } from '../../theme/glass';
import { GlassBackground, GlassCard, GlassButton } from '../../components/glass';
import { AnimatedSpinner } from '../../components/animations';
import { useAuthStore } from '../../stores/authStore';
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
            <Text style={cardStyles.brand}>{brandLabel(method.brand)}</Text>
            {isDefault && (
              <View style={cardStyles.defaultBadge}>
                <Text style={cardStyles.defaultText}>Default</Text>
              </View>
            )}
          </View>
          <Text style={cardStyles.last4}>**** **** **** {method.last4}</Text>
          <Text style={cardStyles.expiry}>
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
  const stripeCustomerId = useAuthStore((s) => s.user?.stripeCustomerId);
  const [methods, setMethods] = useState<PaymentMethodInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

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

  const handleAddPaymentMethod = useCallback(() => {
    Alert.alert(
      'Add Payment Method',
      'Full card entry requires the Stripe SDK (@stripe/stripe-react-native). '
      + 'This feature will be available once the native Stripe module is integrated.',
      [{ text: 'OK' }],
    );
  }, []);

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
            // In production, call paymentService.removePaymentMethod(method.id)
            Alert.alert('Removed', 'Payment method removal will be available with full Stripe integration.');
          },
        },
      ],
    );
  }, []);

  if (isLoading) {
    return (
      <GlassBackground>
        <View style={styles.center}>
          <AnimatedSpinner size={48} color={Colors.primary} />
        </View>
      </GlassBackground>
    );
  }

  return (
    <GlassBackground>
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
        <Text style={styles.title}>Payment Methods</Text>
        <Text style={styles.subtitle}>
          Manage your saved cards for booking services.
        </Text>

        {methods.length === 0 ? (
          /* Empty state */
          <GlassCard variant="dark" style={styles.emptyCard}>
            <View style={styles.emptyState}>
              <View style={styles.emptyIconCircle}>
                <Text style={styles.emptyIcon}>$</Text>
              </View>
              <Text style={styles.emptyTitle}>No Payment Methods</Text>
              <Text style={styles.emptySubtitle}>
                {stripeCustomerId
                  ? 'You have no saved cards yet. Add one to speed up bookings.'
                  : 'Your account does not have a Stripe customer ID yet. Complete a booking to get started.'}
              </Text>
            </View>
          </GlassCard>
        ) : (
          /* Card list */
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

        {/* Add payment method CTA */}
        <GlassButton
          title="+ Add Payment Method"
          variant="glow"
          onPress={handleAddPaymentMethod}
          style={styles.addButton}
        />
      </ScrollView>
    </GlassBackground>
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
});
