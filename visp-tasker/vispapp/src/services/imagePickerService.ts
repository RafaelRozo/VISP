/**
 * Elegir una foto: CÁMARA o GALERÍA.
 *
 * Existe porque media app pedía la foto abriendo directamente el carrete, y eso
 * es la mitad del caso real: la evidencia de una reserva, la foto de un recibo o
 * el estado de un jardín normalmente NO existen todavía — se toman en el momento.
 * Obligar a salir a la app de cámara, volver y buscar la última foto es fricción
 * pura en el punto exacto donde el cliente decide si sigue o abandona.
 *
 * Todo el flujo vive aquí y no en cada pantalla porque el patrón tiene tres
 * pasos fáciles de hacer a medias: preguntar la fuente, pedir EL permiso
 * correcto (cámara y carrete son permisos distintos) y abrir EL picker correcto.
 * Estaba copiado en seis sitios y solo dos ofrecían cámara.
 *
 * El permiso ya está declarado en `app.json` y en `ios/VISP/Info.plist`
 * (`NSCameraUsageDescription`, `NSPhotoLibraryUsageDescription`): sin esa cadena
 * iOS mata la app en cuanto se abre el picker, así que si alguna vez se rehace
 * el proyecto nativo hay que comprobar que sobrevivieron.
 */

import { ActionSheetIOS, Alert, Linking, Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { t } from '../i18n';

export type ImageSource = 'camera' | 'library';

export interface PickImageOptions {
  /** Título del selector de fuente. Por defecto, uno genérico. */
  title?: string;
  /** Permite elegir varias de la galería. La cámara siempre devuelve una. */
  multiple?: boolean;
  /** Tope de selección múltiple (fotos que aún caben). */
  limit?: number;
  /** Compresión de expo-image-picker, 0–1. */
  quality?: number;
  /** Recorte previo — se usa en el avatar, con `aspect`. */
  allowsEditing?: boolean;
  aspect?: [number, number];
}

/**
 * Pregunta qué fuente quiere el usuario.
 *
 * Resuelve a `null` si cancela. iOS usa el ActionSheet nativo; Android, un
 * Alert de tres botones, que es lo que ya hacía `VerificationScreen`.
 */
export function askImageSource(title?: string): Promise<ImageSource | null> {
  const heading = title ?? t('imagePicker.title');
  const camera = t('imagePicker.takePhoto');
  const library = t('imagePicker.chooseFromLibrary');
  const cancel = t('common.cancel');

  return new Promise((resolve) => {
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { title: heading, options: [camera, library, cancel], cancelButtonIndex: 2 },
        (index) => resolve(index === 0 ? 'camera' : index === 1 ? 'library' : null),
      );
      return;
    }
    Alert.alert(heading, undefined, [
      { text: camera, onPress: () => resolve('camera') },
      { text: library, onPress: () => resolve('library') },
      { text: cancel, style: 'cancel', onPress: () => resolve(null) },
    ]);
  });
}

/**
 * Pide el permiso de la fuente elegida.
 *
 * Cuando iOS ya no puede volver a preguntar (`canAskAgain === false`) el botón
 * se quedaría muerto para siempre sin explicación, así que ahí —y solo ahí— se
 * ofrece abrir los Ajustes: es el único sitio donde el usuario puede
 * desbloquearlo.
 */
async function ensurePermission(source: ImageSource): Promise<boolean> {
  const perm =
    source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();

  if (perm.granted) return true;

  const title =
    source === 'camera'
      ? t('imagePicker.cameraDeniedTitle')
      : t('imagePicker.libraryDeniedTitle');
  const body =
    source === 'camera'
      ? t('imagePicker.cameraDeniedBody')
      : t('imagePicker.libraryDeniedBody');

  if (perm.canAskAgain) {
    Alert.alert(title, body);
  } else {
    Alert.alert(title, body, [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('imagePicker.openSettings'), onPress: () => Linking.openSettings() },
    ]);
  }
  return false;
}

/**
 * Selector completo: pregunta la fuente, pide su permiso y abre el picker.
 *
 * Devuelve `[]` en los tres casos en que no hay nada que subir —cancelar,
 * permiso denegado, o cerrar el picker— para que quien llama solo tenga que
 * mirar si el array trae algo.
 */
export async function pickImages(
  options: PickImageOptions = {},
): Promise<ImagePicker.ImagePickerAsset[]> {
  const source = await askImageSource(options.title);
  if (source === null) return [];
  return pickImagesFrom(source, options);
}

/**
 * Abre una fuente concreta, sin preguntar.
 *
 * Para cuando la pantalla ya tiene su propio menú porque ofrece algo más que
 * cámara y galería — el avatar añade "Quitar foto". Aun así pasa por aquí para
 * heredar el permiso correcto y la salida a Ajustes.
 */
export async function pickImagesFrom(
  source: ImageSource,
  options: PickImageOptions = {},
): Promise<ImagePicker.ImagePickerAsset[]> {
  if (!(await ensurePermission(source))) return [];

  const common = {
    mediaTypes: ['images'] as ImagePicker.MediaType[],
    quality: options.quality ?? 0.8,
    allowsEditing: options.allowsEditing ?? false,
    ...(options.aspect ? { aspect: options.aspect } : {}),
  };

  // La cámara devuelve UNA foto: `allowsMultipleSelection` no aplica ahí, y
  // pasárselo hace que iOS ignore también `allowsEditing`.
  const result =
    source === 'camera'
      ? await ImagePicker.launchCameraAsync(common)
      : await ImagePicker.launchImageLibraryAsync({
          ...common,
          allowsMultipleSelection: options.multiple ?? false,
          ...(options.multiple && options.limit ? { selectionLimit: options.limit } : {}),
        });

  if (result.canceled || !result.assets || result.assets.length === 0) return [];
  return result.assets;
}

/** Atajo para el caso de una sola foto. `null` si no hay nada que subir. */
export async function pickImage(
  options: Omit<PickImageOptions, 'multiple' | 'limit'> = {},
): Promise<ImagePicker.ImagePickerAsset | null> {
  const assets = await pickImages({ ...options, multiple: false });
  return assets[0] ?? null;
}

/** Una sola foto de una fuente ya elegida. `null` si no hay nada que subir. */
export async function pickImageFrom(
  source: ImageSource,
  options: Omit<PickImageOptions, 'multiple' | 'limit'> = {},
): Promise<ImagePicker.ImagePickerAsset | null> {
  const assets = await pickImagesFrom(source, { ...options, multiple: false });
  return assets[0] ?? null;
}
