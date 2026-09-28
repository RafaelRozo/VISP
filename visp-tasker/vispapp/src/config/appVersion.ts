/**
 * Versión y build de la app, leídos del binario instalado (Info.plist:
 * CFBundleShortVersionString y CFBundleVersion).
 *
 * Antes estaban escritos a mano en Perfil ('1.0.0', build '10') y en Ajustes
 * (build '1') mientras TestFlight iba por el 31: nadie sabía qué build tenía
 * delante. Leyéndolos del binario, subir CFBundleVersion para TestFlight basta
 * para que la app diga la verdad.
 */

import * as Application from 'expo-application';

export const APP_VERSION: string = Application.nativeApplicationVersion ?? '—';
export const BUILD_NUMBER: string = Application.nativeBuildVersion ?? '—';
