'use client';

import { useState, useEffect } from 'react';

/**
 * Hook to detect if the device has touch capability.
 * Used to differentiate mobile/tablet behavior from desktop.
 *
 * On touch devices, Enter key creates a new line instead of submitting.
 * Users must use the submit button to send messages.
 */
export function useIsTouchDevice(): boolean {
  const [isTouchDevice, setIsTouchDevice] = useState(false);

  useEffect(() => {
    // navigator.maxTouchPoints > 0 reliably detects touch screens
    // This does NOT detect touchpads, only actual touch screens
    setIsTouchDevice(navigator.maxTouchPoints > 0);
  }, []);

  return isTouchDevice;
}
