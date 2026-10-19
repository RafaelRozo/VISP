/**
 * Cabecera JS para los stacks con cabecera nativa, SOLO en Android.
 *
 * Con targetSdk 36 Android dibuja de borde a borde y la cabecera nativa de
 * react-native-screens no aplicaba el inset de arriba en estos stacks: el
 * título y la flecha quedaban debajo de la hora y la batería (visto en el
 * flujo del cliente Cleaning → servicio → Book). `Header` de
 * @react-navigation/elements mide el inset con safe-area en JS, igual que el
 * CustomHeader del stack de Perfil, que ya se veía bien.
 *
 * iOS no cambia: ahí la cabecera nativa funciona y se queda.
 */

import React from 'react';
import { Platform } from 'react-native';
import { Header, HeaderBackButton, getHeaderTitle } from '@react-navigation/elements';
import type { NativeStackHeaderProps } from '@react-navigation/native-stack';

function AndroidStackHeader({ options, route, navigation, back }: NativeStackHeaderProps) {
    const tintColor = options.headerTintColor;
    const showBack = back != null && options.headerBackVisible !== false;
    const headerLeft =
        options.headerLeft ??
        (showBack
            ? () => (
                  <HeaderBackButton
                      tintColor={tintColor}
                      onPress={navigation.goBack}
                      displayMode="minimal"
                  />
              )
            : undefined);

    const bg = (options.headerStyle as { backgroundColor?: string } | undefined)?.backgroundColor;

    return (
        <Header
            title={getHeaderTitle(options, route.name)}
            headerTintColor={tintColor}
            headerTitleStyle={options.headerTitleStyle}
            headerTitleAlign="left"
            headerStyle={bg ? { backgroundColor: bg } : undefined}
            headerShadowVisible={options.headerShadowVisible}
            headerLeft={headerLeft ? (props) => headerLeft({ ...props, canGoBack: showBack }) : undefined}
            headerRight={options.headerRight ? (props) => options.headerRight!({ ...props, canGoBack: showBack }) : undefined}
        />
    );
}

/** Spread en `screenOptions`. En iOS es un objeto vacío. */
export const androidHeaderOptions =
    Platform.OS === 'android'
        ? { header: (props: NativeStackHeaderProps) => <AndroidStackHeader {...props} /> }
        : {};
