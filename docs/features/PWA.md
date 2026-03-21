# Progressive Web App (PWA)

Comprehensive guide to Policy Bot's Progressive Web App capabilities - install, configure, and use Policy Bot as a standalone application.

---

## Table of Contents

1. [Introduction](#introduction)
2. [What is a PWA?](#what-is-a-pwa)
3. [Capabilities](#capabilities)
4. [Installation](#installation)
5. [Configuration](#configuration)
6. [User Experience](#user-experience)
7. [Technical Details](#technical-details)
8. [Browser Support](#browser-support)
9. [Troubleshooting](#troubleshooting)
10. [Admin Configuration](#admin-configuration)

---

## Introduction

Policy Bot is a **Progressive Web App (PWA)**, which means it can be installed on your device and used like a native application - without visiting an app store. Users can add Policy Bot to their home screen (mobile) or desktop and enjoy a streamlined, app-like experience.

### Why PWA?

✅ **No App Store** - Install directly from the browser
✅ **Cross-Platform** - Works on Windows, macOS, Linux, iOS, Android
✅ **Auto-Updates** - Always get the latest version
✅ **Fast & Responsive** - Optimized performance
✅ **App-Like Feel** - No browser UI clutter
✅ **Quick Access** - Launch from home screen or desktop

---

## What is a PWA?

A **Progressive Web App** is a web application that uses modern web technologies to provide an app-like experience:

### Key Characteristics

| Feature | Traditional Website | Progressive Web App |
|---------|---------------------|---------------------|
| **Installation** | No | ✅ Yes - to home screen/desktop |
| **Standalone Window** | Browser UI | ✅ App window (no browser bars) |
| **Icon** | Favicon | ✅ Full-size app icon |
| **Offline Support** | No | ⚠️ Limited (see capabilities) |
| **Push Notifications** | Limited | ⚠️ Not implemented |
| **App Store** | N/A | Not needed |

### How It Works

```
User visits Policy Bot
        ↓
Browser detects PWA manifest
        ↓
Install prompt appears (or manual install)
        ↓
User clicks "Install"
        ↓
App icon added to device
        ↓
Launches in standalone window
        ↓
Behaves like native app
```

---

## Capabilities

### ✅ What Works

Policy Bot PWA provides these capabilities:

#### 1. Standalone App Window
- ✅ No browser UI (address bar, tabs, bookmarks)
- ✅ Clean, distraction-free interface
- ✅ Dedicated window for Policy Bot
- ✅ App-switching via OS task switcher

#### 2. Home Screen / Desktop Icon
- ✅ Custom app icon (from branding settings)
- ✅ Custom app name (from branding settings)
- ✅ Quick launch like any other app
- ✅ Icon matches organization branding

#### 3. Theme Customization
- ✅ Custom theme color (status bar on mobile)
- ✅ Custom background color
- ✅ Follows branding configuration
- ✅ Consistent visual identity

#### 4. Full Functionality
- ✅ All Policy Bot features work in PWA mode
- ✅ Chat interface
- ✅ Document uploads
- ✅ Voice input
- ✅ File downloads
- ✅ Thread management
- ✅ Admin/Superuser dashboards

#### 5. Responsive Design
- ✅ Adapts to any screen size
- ✅ Mobile-optimized layouts
- ✅ Touch-friendly controls
- ✅ Desktop-optimized views

#### 6. Auto-Updates
- ✅ Service worker checks for updates
- ✅ New version installed automatically
- ✅ Page auto-reloads when new version activates
- ✅ No manual update process

### ❌ Limitations

Policy Bot PWA has these limitations:

#### 1. Online Connectivity Required
- ❌ No offline document search (requires server)
- ❌ No offline chat (requires LLM API)
- ❌ Thread data not cached locally
- ⚠️ Offline banner notification shown when disconnected

**Why:** Document search, embedding generation, and LLM chat all require server connectivity.

#### 2. No Push Notifications
- ❌ No background notifications
- ❌ No alerts when app is closed
- ❌ No badges on app icon

**Why:** Not implemented in current version.

#### 3. No Background Sync
- ❌ No background data synchronization
- ❌ No queued operations when offline

**Why:** All operations are server-dependent.

#### 4. Limited Offline Functionality
- ⚠️ Only offline banner notification (no dedicated offline page)
- ❌ Cannot browse cached threads
- ❌ Cannot search documents offline

**Why:** By design - Policy Bot is a connected application.

### 🔜 Future Enhancements

Potential future PWA features:
- 🔜 Offline thread viewing (read-only)
- 🔜 Push notifications for shared threads
- 🔜 Background sync for drafts
- 🔜 Richer offline experience

---

## Installation

### Desktop Installation

#### Google Chrome / Microsoft Edge

1. **Visit Policy Bot** in your browser
2. Look for the **install icon** in the address bar:
   - Chrome: ⊕ icon or computer with arrow
   - Edge: ➕ icon
3. **Click the install icon**
4. **Confirm installation** in the popup
5. Policy Bot opens in a standalone window
6. **App icon** appears:
   - Windows: Start Menu and Desktop
   - macOS: Applications folder and Dock
   - Linux: Applications menu

**Alternative Method:**
1. Click the **three-dot menu** (⋮)
2. Select **"Install Policy Bot"** or **"Install app"**
3. Confirm installation

#### Safari (macOS)

1. **Visit Policy Bot** in Safari
2. Click **Share** button (box with arrow)
3. Select **"Add to Dock"**
4. Confirm and add to Dock
5. Launch from Dock

**Note:** Safari's PWA support is more limited than Chrome/Edge.

#### Firefox

Firefox has limited PWA support:
- ❌ No built-in install option on desktop
- ⚠️ Use Chrome or Edge for best experience
- ✅ Works on Firefox for Android

### Mobile Installation

#### Android (Chrome)

1. **Visit Policy Bot** in Chrome
2. **Install banner** appears at bottom of screen:
   ```
   ┌────────────────────────────┐
   │ 📦 Install App             │
   │ Add to home screen for     │
   │ quick access               │
   │ [Install] [Dismiss]        │
   └────────────────────────────┘
   ```
3. **Tap "Install"**
4. Or use **three-dot menu** → **"Install app"** or **"Add to Home screen"**
5. Icon appears on home screen
6. **Launch** from home screen

**Auto-Prompt:**
- Banner appears automatically after a few visits
- Can be dismissed and shown again later
- Respects user preference (won't nag)

#### iOS (Safari)

1. **Visit Policy Bot** in Safari
2. **Tap Share button** (box with arrow up)
3. **Scroll down** and select **"Add to Home Screen"**
4. **Edit name** if desired (defaults to site name)
5. **Tap "Add"**
6. Icon appears on home screen
7. **Launch** from home screen

**iOS Notes:**
- Safari's PWA support is improving but limited
- No install banner (must use Share menu)
- Some features may be restricted by iOS
- Standalone mode supported

### Manual Installation

If automatic prompts don't appear:

1. Check browser supports PWA (Chrome, Edge, Safari)
2. Ensure HTTPS connection (required for PWA)
3. Try hard refresh: Ctrl+Shift+R (Cmd+Shift+R on Mac)
4. Clear browser cache and revisit
5. Check browser console for errors

---

## Configuration

### User Configuration

**Icon and Name:**
- Automatically use branding from admin settings
- Custom app name from "Bot Name" setting
- Custom icon from branding icon selection

**Theme:**
- App theme color set by admin
- Background color set by admin
- Accent color follows user preference

### Uninstalling

#### Desktop

**Chrome / Edge:**
1. Open Policy Bot PWA
2. Click **three-dot menu** (⋮) in app window
3. Select **"Uninstall Policy Bot"**
4. Confirm removal

**Alternative:**
- Windows: Apps & features → Policy Bot → Uninstall
- macOS: Applications → Move to Trash
- Linux: Application menu → Right-click → Remove

#### Mobile

**Android:**
1. **Long-press** the Policy Bot icon
2. Select **"Uninstall"** or **"App info"** → Uninstall

**iOS:**
1. **Long-press** the Policy Bot icon
2. Select **"Remove App"**
3. **Choose "Delete App"**

---

## User Experience

### Standalone Mode

When launched as a PWA, Policy Bot runs in **standalone mode**:

**Visual Changes:**
- ❌ No browser address bar
- ❌ No browser tabs
- ❌ No bookmarks bar
- ✅ Full-screen app interface
- ✅ Custom window controls
- ✅ App appears in task switcher

**Behavioral Changes:**
- ✅ Links open within the app
- ✅ External links may open in browser (configurable)
- ✅ App remembers last page/state
- ✅ Separate from browser session

### App Lifecycle

#### First Launch
1. App loads from network
2. Service worker installs
3. Assets cached for faster subsequent loads
4. User sees chat interface

#### Subsequent Launches
1. App loads from cache (fast)
2. Service worker checks for updates
3. If update available: downloads in background
4. Prompts user to reload when ready

#### Update Process

When a new version is deployed:

1. Service worker detects the update
2. New service worker installs and activates
3. Page automatically reloads to apply the update
4. User sees the latest version

**Note:** Updates are automatic - no user prompt is shown. The page reloads seamlessly when a new service worker takes control.

### Offline Behavior

When internet connection is lost:

```
┌──────────────────────────────────────────────────────────────────┐
│ 📶 You're offline. Some features may be unavailable.             │
└──────────────────────────────────────────────────────────────────┘
```

An amber notification banner appears at the top of the screen.

**What Happens:**
- ✅ Offline banner displayed at top of page
- ✅ Cached static assets (JS, CSS, icons) still load
- ❌ Cannot chat or search (requires server)
- ❌ Cannot load new data
- ✅ Banner auto-hides when connection restored

---

## Technical Details

### Web App Manifest

Policy Bot uses a **dynamic manifest** generated at runtime:

**Endpoint:** `https://your-domain.com/manifest.webmanifest`

**Generated Manifest Example:**
```json
{
  "id": "/",
  "scope": "/",
  "name": "Policy Bot",
  "short_name": "PolicyBot",
  "description": "AI-powered policy assistant",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#2563eb",
  "orientation": "portrait-primary",
  "prefer_related_applications": false,
  "icons": [
    {
      "src": "/icons/icon-192x192.png",
      "sizes": "192x192",
      "type": "image/png",
      "purpose": "any"
    },
    {
      "src": "/icons/icon-192x192.png",
      "sizes": "192x192",
      "type": "image/png",
      "purpose": "maskable"
    },
    {
      "src": "/icons/icon-512x512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "any"
    },
    {
      "src": "/icons/icon-512x512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "maskable"
    }
  ]
}
```

**Dynamic Values:**
- `name` - From branding settings (Bot Name)
- `short_name` - Truncated bot name
- `theme_color` - From PWA settings
- `background_color` - From PWA settings
- `icons` - Generated from branding icon selection

### Service Worker

**Location:** `/public/sw.js` (static file)

**Current Version:** v3

**Responsibilities:**
- Cache static Next.js assets (`/_next/static/*`)
- Cache application icons (`/icons/*`)
- Update management with automatic activation

**Caching Strategy:**
- **Static Next.js assets** (`/_next/static/*`) - Cache-first with network fallback
- **Icons** (`/icons/*`) - Cache-first with network fallback
- **API requests** (`/api/*`) - Bypassed (network-only)
- **Next.js data routes** (`/_next/data/*`) - Bypassed (network-only)
- **Other requests** - Pass through without SW intervention

**Update Strategy:**
1. Service worker uses `skipWaiting()` for immediate activation
2. Old caches are cleaned up based on version number
3. When new SW takes control, page auto-reloads via `controllerchange` event
4. Updates take effect immediately

### Icon Generation

Icons are configured via admin branding settings:

**Available Options:**
1. **Preset Icons** (12 options):
   - Government, Operations, Finance, KPI, Logs, Data
   - Monitoring, Architecture, Internet, Systems, Policy
2. **Custom Upload** - Upload custom PNG/JPEG/WebP (max 5MB)

**Process:**
1. Admin selects preset icon OR uploads custom icon in branding settings
2. Custom icons are saved to `/public/icons/` directory
3. Manifest automatically references the configured icon paths
4. Both 192x192 and 512x512 sizes are supported

**Icon Requirements:**
- **192x192** - Home screen icon (Android)
- **512x512** - Splash screen (Android)
- **Maskable** - Adaptive icons (Android)

### Offline Banner

**Component:** `src/components/pwa/OfflineBanner.tsx`

**Behavior:**
- Displays amber banner at top of page when offline
- Shows WiFi icon with "You're offline" message
- Automatically hides when connection is restored
- Uses `useOnlineStatus` hook to detect connectivity

**Note:** There is no dedicated offline page. The app shows a notification banner while the existing page content remains visible (though non-functional).

### Browser APIs Used

| API | Purpose | Support |
|-----|---------|---------|
| Service Worker | Caching, updates, offline | Chrome, Edge, Safari, Firefox |
| Web App Manifest | Installation, metadata | Chrome, Edge, Safari, Firefox |
| Cache API | Asset caching | Chrome, Edge, Safari, Firefox |
| Fetch API | Network requests | Universal |
| localStorage | Settings persistence | Universal |

---

## Browser Support

### Desktop

| Browser | Install | Standalone | Updates | Offline | Notes |
|---------|---------|------------|---------|---------|-------|
| **Chrome** | ✅ | ✅ | ✅ | ⚠️ | Best support |
| **Edge** | ✅ | ✅ | ✅ | ⚠️ | Based on Chromium |
| **Safari** | ⚠️ | ⚠️ | ✅ | ⚠️ | Limited support |
| **Firefox** | ❌ | ❌ | N/A | ⚠️ | Desktop not supported |

### Mobile

| Browser | Install | Standalone | Updates | Offline | Notes |
|---------|---------|------------|---------|---------|-------|
| **Chrome (Android)** | ✅ | ✅ | ✅ | ⚠️ | Excellent support |
| **Safari (iOS)** | ✅ | ✅ | ✅ | ⚠️ | Good support |
| **Firefox (Android)** | ✅ | ✅ | ✅ | ⚠️ | Good support |
| **Samsung Internet** | ✅ | ✅ | ✅ | ⚠️ | Good support |

**Legend:**
- ✅ Full support
- ⚠️ Limited support
- ❌ Not supported

### Recommended Browsers

**Best Experience:**
1. **Chrome** (desktop and mobile)
2. **Edge** (desktop)
3. **Safari** (iOS)

**Acceptable:**
- Firefox Android
- Samsung Internet
- Safari desktop (limited)

**Not Recommended:**
- Firefox desktop (no PWA support)
- Internet Explorer (unsupported)

---

## Troubleshooting

### Issue: Install Prompt Not Appearing

**Possible Causes:**
- Browser doesn't support PWA
- Not using HTTPS
- Already installed
- User previously dismissed

**Solutions:**
1. Verify browser supports PWA (Chrome, Edge, Safari)
2. Check URL uses HTTPS (not HTTP)
3. Check if already installed (look for app icon)
4. Clear site data and revisit
5. Try different browser
6. Hard refresh: Ctrl+Shift+R (Cmd+Shift+R)

### Issue: Icon or Name Incorrect

**Possible Causes:**
- Manifest not updated
- Old icon cached
- Branding settings not saved

**Solutions:**
1. **Admin:** Verify branding settings saved
2. Uninstall and reinstall PWA
3. Clear browser cache
4. Check manifest at `/manifest.webmanifest`
5. Verify icon files exist in `/icons/`

### Issue: App Opens in Browser, Not Standalone

**Possible Causes:**
- Not launched from installed icon
- Browser override setting
- Deep link from external app

**Solutions:**
1. Launch from home screen / desktop icon
2. Don't launch from bookmarks or browser
3. Check browser PWA settings
4. Reinstall the app

### Issue: Offline Banner Not Showing

**Possible Causes:**
- JavaScript not loaded
- Component not mounted
- Browser doesn't support online/offline events

**Solutions:**
1. Hard refresh the page while online
2. Check browser console for errors
3. Verify `OfflineBanner` component is rendered in layout
4. Test by toggling network in DevTools (Network tab → Offline)

### Issue: Update Not Installing

**Possible Causes:**
- Multiple tabs open
- Service worker conflict
- Browser preventing update

**Solutions:**
1. Close all Policy Bot tabs
2. Clear service worker cache
3. Unregister service worker in DevTools
4. Reload the page
5. Reinstall if necessary

### Issue: App Not Working After Update

**Possible Causes:**
- Incomplete update
- Cache conflict
- Breaking change

**Solutions:**
1. Hard refresh: Ctrl+Shift+R (Cmd+Shift+R)
2. Clear site data (Settings → Privacy)
3. Uninstall and reinstall
4. Contact admin if persists

---

## Admin Configuration

### Branding Settings

**Location:** Admin → Settings → Branding

Configure PWA appearance:

| Setting | Description | Impact on PWA |
|---------|-------------|---------------|
| **Bot Name** | Application name | Manifest `name` and `short_name` |
| **Bot Icon** | Icon image | Generates 192x192 and 512x512 icons |
| **Accent Color** | Primary color | User customization (not PWA theme) |

**Setting Bot Icon:**
1. Navigate to Admin → Settings → Branding
2. Choose from 12 preset icons OR upload a custom icon
3. Custom icons: PNG/JPEG/WebP, max 5MB, saved to `/public/icons/`
4. Save settings
5. Manifest automatically updated with new icon paths

### PWA Settings

**Location:** Admin → Settings → General (or PWA section)

| Setting | Default | Description |
|---------|---------|-------------|
| **Enable PWA** | true | Allow installation |
| **Theme Color** | #2563eb | Status bar color (mobile) |
| **Background Color** | #ffffff | App background |
| **Show Install Banner** | true | Auto-prompt users to install |

**Theme Color:**
- Affects mobile status bar
- Matches organization branding
- Hex color format (#RRGGBB)

**Background Color:**
- Shown during app launch
- Before content loads
- Usually white or brand color

### Testing PWA Configuration

**Steps:**
1. Update branding settings
2. Open `/manifest.webmanifest` in browser
3. Verify settings reflected in JSON
4. Test installation on device
5. Verify icon and name correct

**DevTools Testing:**
1. Open Chrome DevTools
2. Navigate to **Application** tab
3. Check **Manifest** section
4. Verify all fields correct
5. Check **Service Workers** section
6. Verify service worker registered

### Deployment Considerations

**Production Checklist:**
- ✅ HTTPS enabled (required for PWA)
- ✅ SSL certificate valid
- ✅ Branding settings configured
- ✅ Icons available (192x192, 512x512)
- ✅ Service worker deployed (`/sw.js`)
- ✅ Manifest accessible at `/manifest.webmanifest`
- ✅ Offline banner functional
- ✅ Test installation on multiple devices

**Performance:**
- PWA assets cached for fast loading
- First load requires network
- Subsequent loads near-instant
- Service worker checks for updates

---

*Last updated: March 2026 (v1.2)*
