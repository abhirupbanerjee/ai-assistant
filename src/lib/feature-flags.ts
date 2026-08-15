/**
 * Runtime feature flags.
 *
 * Prefer explicit environment variables for coarse on/off toggles so rollouts
 * can be controlled without a code deploy.
 */

/**
 * Mobile edge-to-edge header refactor:
 * Removes the permanent top padding band on mobile and replaces it with a
 * scroll-start spacer + local clearance for welcome/summary/offline states.
 */
export const EDGE_TO_EDGE_MOBILE_HEADER =
  process.env.NEXT_PUBLIC_EDGE_TO_EDGE_MOBILE_HEADER === 'true';
