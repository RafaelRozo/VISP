import React, { useRef, useState, useEffect } from 'react';
import { View, Text, TextInput, StyleSheet, Animated, Easing, Keyboard, Platform } from 'react-native';
import { Colors } from '../theme/colors';

interface AnimatedCreditCardProps {
  onCardChange: (details: {
    number: string;
    exp_month: string;
    exp_year: string;
    cvc: string;
    complete: boolean;
  }) => void;
}

export default function AnimatedCreditCard({ onCardChange }: AnimatedCreditCardProps) {
  const [number, setNumber] = useState('');
  const [expiry, setExpiry] = useState('');
  const [cvc, setCvc] = useState('');
  const [isFlipped, setIsFlipped] = useState(false);

  const flipAnimation = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Notify parent
    const cleanNumber = number.replace(/\s/g, '');
    const expParts = expiry.split('/');
    const hasValidNumber = cleanNumber.length >= 15;
    const hasValidExpiry = expParts.length === 2 && expParts[0].length === 2 && expParts[1].length === 2;
    const hasValidCvc = cvc.length >= 3;
    const complete = hasValidNumber && hasValidExpiry && hasValidCvc;
    onCardChange({
      number: cleanNumber,
      exp_month: expParts[0] || '',
      exp_year: expParts[1] ? `20${expParts[1]}` : '',
      cvc,
      complete,
    });
  }, [number, expiry, cvc, onCardChange]);

  useEffect(() => {
    Animated.timing(flipAnimation, {
      toValue: isFlipped ? 180 : 0,
      duration: 500,
      easing: Easing.out(Easing.poly(4)),
      useNativeDriver: true,
    }).start();
  }, [isFlipped]);

  const frontInterpolate = flipAnimation.interpolate({
    inputRange: [0, 180],
    outputRange: ['0deg', '180deg'],
  });

  const backInterpolate = flipAnimation.interpolate({
    inputRange: [0, 180],
    outputRange: ['180deg', '360deg'],
  });

  const frontAnimatedStyle = { transform: [{ rotateY: frontInterpolate }] };
  const backAnimatedStyle = { transform: [{ rotateY: backInterpolate }] };

  // Detect card brand
  let brandObj = 'VISA';
  if (number.startsWith('5')) brandObj = 'MASTERCARD';
  if (number.startsWith('34') || number.startsWith('37')) brandObj = 'AMEX';
  if (number.startsWith('6')) brandObj = 'DISCOVER';

  return (
    <View style={styles.wrapper}>
      {/* 3D Card Container */}
      <View style={styles.cardContainer}>
        {/* Front */}
        <Animated.View style={[styles.card, styles.cardFront, frontAnimatedStyle]}>
          <View style={styles.cardGlow} />
          <View style={styles.frontTop}>
            <Text style={styles.cardBrand}>{brandObj}</Text>
            <View style={styles.chip} />
          </View>
          <Text style={styles.cardNumberDisplay}>
            {number || 'XXXX XXXX XXXX XXXX'}
          </Text>
          <View style={styles.frontBottom}>
            <View>
              <Text style={styles.cardLabel}>Cardholder</Text>
              <Text style={styles.cardValue}>VISP USER</Text>
            </View>
            <View>
              <Text style={styles.cardLabel}>Expires</Text>
              <Text style={styles.cardValue}>{expiry || 'MM/YY'}</Text>
            </View>
          </View>
        </Animated.View>

        {/* Back */}
        <Animated.View style={[styles.card, styles.cardBack, backAnimatedStyle]}>
          <View style={styles.magneticStrip} />
          <View style={styles.signatureStrip}>
            <Text style={styles.cvcDisplay}>{cvc || 'CVC'}</Text>
          </View>
          <Text style={styles.backWarning}>This card is issued by VISP Financial Services.</Text>
        </Animated.View>
      </View>

      {/* Form Inputs */}
      <View style={styles.formContainer}>
        <TextInput
          style={styles.input}
          placeholder="Card Number"
          placeholderTextColor="rgba(255,255,255,0.3)"
          keyboardType="number-pad"
          maxLength={19}
          value={number}
          onFocus={() => setIsFlipped(false)}
          onChangeText={(text) => {
            let cleaned = text.replace(/\D/g, '');
            let formatted = cleaned.match(/.{1,4}/g)?.join(' ') || '';
            setNumber(formatted);
          }}
        />
        <View style={styles.row}>
          <TextInput
            style={[styles.input, { flex: 1, marginRight: 8 }]}
            placeholder="MM/YY"
            placeholderTextColor="rgba(255,255,255,0.3)"
            keyboardType="number-pad"
            maxLength={5}
            value={expiry}
            onFocus={() => setIsFlipped(false)}
            onChangeText={(text) => {
              let cleaned = text.replace(/\D/g, '');
              if (cleaned.length >= 2) {
                cleaned = cleaned.substring(0, 2) + '/' + cleaned.substring(2, 4);
              }
              setExpiry(cleaned);
            }}
          />
          <TextInput
            style={[styles.input, { flex: 1, marginLeft: 8 }]}
            placeholder="CVC"
            placeholderTextColor="rgba(255,255,255,0.3)"
            keyboardType="number-pad"
            maxLength={4}
            value={cvc}
            onFocus={() => setIsFlipped(true)}
            onBlur={() => setIsFlipped(false)}
            onChangeText={(text) => setCvc(text.replace(/\D/g, ''))}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    alignItems: 'center',
    width: '100%',
    marginBottom: 20,
  },
  cardContainer: {
    width: 320,
    height: 200,
    marginBottom: 24,
  },
  card: {
    position: 'absolute',
    width: '100%',
    height: '100%',
    borderRadius: 16,
    backfaceVisibility: 'hidden',
    backgroundColor: 'rgba(30, 40, 80, 0.8)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    overflow: 'hidden',
    padding: 20,
    ...Platform.select({
      ios: {
        shadowColor: Colors.primary,
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.4,
        shadowRadius: 20,
      },
      android: { elevation: 10 },
    }),
  },
  cardFront: {
    justifyContent: 'space-between',
  },
  cardBack: {
    justifyContent: 'center',
    padding: 0,
    paddingTop: 30,
  },
  cardGlow: {
    position: 'absolute',
    top: -50,
    left: -50,
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: 'rgba(120, 80, 255, 0.2)',
    opacity: 0.5,
  },
  frontTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardBrand: {
    color: '#FFF',
    fontSize: 22,
    fontWeight: '800',
    fontStyle: 'italic',
    letterSpacing: 1,
  },
  chip: {
    width: 40,
    height: 30,
    borderRadius: 6,
    backgroundColor: 'rgba(255, 215, 0, 0.7)',
    borderWidth: 1,
    borderColor: 'rgba(255, 215, 0, 0.9)',
  },
  cardNumberDisplay: {
    color: '#FFF',
    fontSize: 22,
    fontWeight: '600',
    letterSpacing: 2,
    textShadowColor: 'rgba(0, 0, 0, 0.3)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 2,
  },
  frontBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  cardLabel: {
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 4,
  },
  cardValue: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: 1,
  },
  magneticStrip: {
    width: '100%',
    height: 40,
    backgroundColor: '#000',
    marginBottom: 20,
  },
  signatureStrip: {
    width: '80%',
    height: 40,
    backgroundColor: '#FFF',
    alignSelf: 'center',
    justifyContent: 'center',
    paddingRight: 10,
    borderRadius: 4,
  },
  cvcDisplay: {
    color: '#000',
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'right',
  },
  backWarning: {
    color: 'rgba(255, 255, 255, 0.4)',
    fontSize: 8,
    textAlign: 'center',
    marginTop: 20,
    paddingHorizontal: 20,
  },
  formContainer: {
    width: '100%',
    paddingHorizontal: 8,
  },
  input: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(120, 80, 255, 0.3)',
    borderRadius: 12,
    color: '#FFF',
    padding: 16,
    fontSize: 16,
    marginBottom: 16,
  },
  row: {
    flexDirection: 'row',
    width: '100%',
  },
});
