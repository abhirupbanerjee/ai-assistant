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
- ✅ User prompted to reload when update available
- ✅ No manual update process

### ❌ Limitations

Policy Bot PWA has these limitations:

#### 1. Online Connectivity Required
- ❌ No offline document search (requires server)
- ❌ No offline chat (requires LLM API)
- ❌ Thread data not cached locally
- ⚠️ Basic offline page shown when disconnected

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
- ⚠️ Only basic offline page available
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
```
┌────────────────────────────────┐
│ 🔄 Update Available            │
│ A new version of Policy Bot is │
│ available. Reload to update?   │
│ [Later] [Reload Now]           │
└────────────────────────────────┘
```

User can:
- **Reload Now** - Apply update immediately
- **Later** - Continue with current version, update on next launch

### Offline Behavior

When internet connection is lost:

```
┌────────────────────────────────┐
│ 🌐 You're Offline              │
│                                │
│ Policy Bot requires an internet│
│ connection to access documents │
│ and chat with the AI.          │
│                                │
│ Please check your connection   │
│ and try again.                 │
│                                │
│ [Retry Connection]             │
└────────────────────────────────┘
```

**What Happens:**
- ✅ Offline page displayed
- ❌ Cannot chat or search
- ❌ Cannot load new data
- ✅ Retry button to check connection
- ✅ Auto-reconnects when online

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

**Location:** `/sw.js` (generated during build)

**Responsibilities:**
- Cache static assets (JS, CSS, fonts)
- Handle offline requests
- Update management
- Background sync (if enabled)

**Caching Strategy:**
- **Static assets** - Cache-first (with network fallback)
- **API requests** - Network-only (no cache)
- **Images** - Cache-first with expiration

**Update Strategy:**
1. Service worker checks for updates on launch
2. If new version detected, downloads in background
3. Waits for all tabs to close (or prompts user)
4. Activates new service worker
5. Updates take effect on next launch

### Icon Generation

Icons are automatically generated from branding settings:

**Process:**
1. Admin selects bot icon in branding settings
2. Icon is saved to database
3. Script generates 192x192 and 512x512 PNG versions
4. Icons saved to `/public/icons/`
5. Manifest updated with icon paths

**Icon Requirements:**
- **192x192** - Home screen icon (Android)
- **512x512** - Splash screen (Android)
- **Maskable** - Adaptive icons (Android)

### Offline Page

**Location:** `/offline` route

**Content:**
- Friendly offline message
- Explanation of why app is offline
- Retry button to check connection
- Branding consistent with app

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

### Issue: Offline Page Not Showing

**Possible Causes:**
- Service worker not registered
- Cache not populated
- Browser doesn't support service worker

**Solutions:**
1. Check service worker in DevTools
2. Visit app while online first
3. Clear cache and reload
4. Check browser console for errors

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
1. Navigate to Branding settings
2. Select icon from presets or upload custom
3. Save settings
4. Icons automatically generated for PWA
5. Manifest updated with new icon paths

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
- ✅ Icons generated (192x192, 512x512)
- ✅ Service worker deployed
- ✅ Manifest accessible at `/manifest.webmanifest`
- ✅ Offline page functional
- ✅ Test installation on multiple devices

**Performance:**
- PWA assets cached for fast loading
- First load requires network
- Subsequent loads near-instant
- Service worker checks for updates

---

*Last updated: January 2025 (v1.0)*
