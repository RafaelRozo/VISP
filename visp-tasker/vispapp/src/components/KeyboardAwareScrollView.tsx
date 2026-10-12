/**
 * ScrollView que en Android sube el campo enfocado por encima del teclado.
 *
 * Mismo motivo que ./KeyboardAvoidingView: con edge-to-edge Android ya no
 * encoge la ventana, así que un campo en la mitad de abajo de un ScrollView
 * quedaba tapado. En iOS es el ScrollView de siempre (mismas props, mismo ref),
 * para no cambiar nada allí.
 */

import React, {forwardRef} from 'react';
import {Platform, ScrollView, ScrollViewProps} from 'react-native';
import {
  KeyboardAwareScrollView as KCKeyboardAwareScrollView,
  type KeyboardAwareScrollViewRef,
} from 'react-native-keyboard-controller';

// Hueco entre el campo y el borde del teclado.
const ANDROID_BOTTOM_OFFSET = 24;

const KeyboardAwareScrollView = forwardRef<ScrollView, ScrollViewProps>(
  function KeyboardAwareScrollView(props, ref) {
    if (Platform.OS === 'ios') {
      return <ScrollView ref={ref} {...props} />;
    }
    return (
      <KCKeyboardAwareScrollView
        // Es un ScrollView con un método más: quien use el ref (scrollTo,
        // scrollToEnd) recibe lo mismo que en iOS.
        ref={ref as React.Ref<KeyboardAwareScrollViewRef>}
        bottomOffset={ANDROID_BOTTOM_OFFSET}
        keyboardShouldPersistTaps="handled"
        {...props}
      />
    );
  },
);

export default KeyboardAwareScrollView;
