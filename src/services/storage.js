import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

async function getWebStorage() {
  if (typeof window === "undefined") {
    return null;
  }

  return window.localStorage;
}

export async function loadItem(key) {
  if (Platform.OS === "web") {
    const storage = await getWebStorage();
    return storage ? storage.getItem(key) : null;
  }

  return SecureStore.getItemAsync(key);
}

export async function saveItem(key, value) {
  if (Platform.OS === "web") {
    const storage = await getWebStorage();

    if (storage) {
      storage.setItem(key, value);
    }

    return;
  }

  await SecureStore.setItemAsync(key, value);
}

export async function loadJson(key, fallbackValue) {
  const rawValue = await loadItem(key);

  if (!rawValue) {
    return fallbackValue;
  }

  try {
    return JSON.parse(rawValue);
  } catch {
    return fallbackValue;
  }
}

export async function saveJson(key, value) {
  await saveItem(key, JSON.stringify(value));
}