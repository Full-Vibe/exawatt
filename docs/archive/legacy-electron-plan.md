# Archived: Legacy Electron Implementation Plan

Status: historical context.

Electron remains the active desktop shell direction, but this older phase plan is no longer the canonical roadmap. Current direction lives in `docs/engineering/roadmap.md` and current architecture lives in `docs/engineering/architecture.md`.

---

# Exawatt Electron Desktop App - Implementation Plan

## Overview

Convert Exawatt into a native-feeling Electron desktop app while maintaining the existing web deployment on Vercel. The approach is phased: ship quickly with a simple wrapper, then enhance for a more native experience.

### Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                         Shared Codebase                          │
│                    (React components, UI, styles)                │
└──────────────────────────────────────────────────────────────────┘
                    │                              │
                    ▼                              ▼
        ┌─────────────────────┐        ┌─────────────────────────┐
        │   Web (Vercel)      │        │   Desktop (Electron)     │
        │                     │        │                          │
        │   - SSR rendering   │        │   Phase 1: Load live     │
        │   - Server actions  │        │   Phase 2: Static bundle │
        │   - Full Next.js    │        │   + API calls            │
        └──────────┬──────────┘        └───────────┬──────────────┘
                   │                               │
                   └───────────────┬───────────────┘
                                   ▼
                    ┌──────────────────────────────┐
                    │    API Routes (Phase 2+)     │
                    │    /api/tasks, /api/projects │
                    │    Hosted on exawatt.ai      │
                    └──────────────┬───────────────┘
                                   ▼
                            ┌───────────┐
                            │  Supabase │
                            └───────────┘
```

---

## Phase 1: Quick Ship (Load Live Site)

**Goal:** Get a working Electron app in hours, not days.

The Electron app simply loads `https://exawatt.ai` in a native window. Zero code changes to the existing app.

### 1.1 Install Dependencies

```bash
pnpm add -D electron electron-builder concurrently wait-on cross-env
pnpm add -D @types/electron
```

### 1.2 Create Directory Structure

```
/electron
  /main
    main.ts           # Main process entry point
    preload.ts        # Preload script for IPC bridge
  /resources
    icon.icns         # macOS app icon (512x512)
    icon.ico          # Windows icon (future)
    icon.png          # Linux icon (future)
  tsconfig.json       # TypeScript config for electron code
/electron-builder.yml # Build configuration
```

### 1.3 Main Process Entry Point

**File: `/electron/main/main.ts`**

```typescript
import { app, BrowserWindow, shell, Menu } from 'electron';
import path from 'path';

const isDev = process.env.NODE_ENV === 'development';
const PROD_URL = 'https://exawatt.ai';
const DEV_URL = 'http://localhost:7000';

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: '#09090b', // matches your dark theme
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  // Load the app
  const url = isDev ? DEV_URL : PROD_URL;
  mainWindow.loadURL(url);

  // Open external links in default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // Dev tools in development
  if (isDev) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// macOS-style menu
function createMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(isDev ? [{ type: 'separator' as const }, { role: 'toggleDevTools' as const }] : []),
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// App lifecycle
app.whenReady().then(() => {
  createMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
```

### 1.4 Preload Script

**File: `/electron/main/preload.ts`**

```typescript
import { contextBridge, ipcRenderer } from 'electron';

// Expose protected methods to renderer process
contextBridge.exposeInMainWorld('electron', {
  isElectron: true,
  platform: process.platform,
  // Add more IPC methods as needed
  send: (channel: string, data: unknown) => {
    const validChannels = ['app-event'];
    if (validChannels.includes(channel)) {
      ipcRenderer.send(channel, data);
    }
  },
});
```

### 1.5 TypeScript Configuration

**File: `/electron/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "outDir": "../dist-electron",
    "rootDir": ".",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["**/*.ts"],
  "exclude": ["node_modules"]
}
```

### 1.6 Build Configuration

**File: `/electron-builder.yml`**

```yaml
appId: com.exawatt.app
productName: Exawatt
copyright: Copyright © 2024 Exawatt

directories:
  output: release
  buildResources: electron/resources

files:
  - dist-electron/**/*
  - "!node_modules/**/*"

mac:
  category: public.app-category.developer-tools
  icon: electron/resources/icon.icns
  target:
    - target: dmg
      arch: [universal]
    - target: zip
      arch: [universal]
  hardenedRuntime: true
  gatekeeperAssess: false
  entitlements: electron/entitlements.mac.plist
  entitlementsInherit: electron/entitlements.mac.plist

dmg:
  contents:
    - x: 130
      y: 220
    - x: 410
      y: 220
      type: link
      path: /Applications
  window:
    width: 540
    height: 380

# Future: Windows and Linux
# win:
#   target: [nsis, zip]
#   icon: electron/resources/icon.ico
#
# linux:
#   target: [AppImage, deb]
#   icon: electron/resources/icon.png
#   category: Development
```

### 1.7 macOS Entitlements

**File: `/electron/entitlements.mac.plist`**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.allow-jit</key>
  <true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
  <true/>
  <key>com.apple.security.network.client</key>
  <true/>
</dict>
</plist>
```

### 1.8 Package.json Updates

Add to `/package.json`:

```json
{
  "main": "dist-electron/main/main.js",
  "scripts": {
    "electron:compile": "tsc -p electron/tsconfig.json",
    "electron:dev": "pnpm electron:compile && concurrently \"pnpm dev\" \"wait-on http://localhost:7000 && cross-env NODE_ENV=development electron .\"",
    "electron:build": "pnpm electron:compile && electron-builder --mac",
    "electron:build:all": "pnpm electron:compile && electron-builder --mac --win --linux"
  }
}
```

### 1.9 Gitignore Updates

Add to `/.gitignore`:

```
# Electron
dist-electron/
release/
*.dmg
*.AppImage
*.exe
```

### 1.10 Type Definitions

**File: `/src/types/electron.d.ts`**

```typescript
export {};

declare global {
  interface Window {
    electron?: {
      isElectron: boolean;
      platform: string;
      send: (channel: string, data: unknown) => void;
    };
  }
}
```

---

## Phase 2: API Routes

**Goal:** Create a proper API layer that both web and Electron can use.

This enables Phase 3 (static bundle) and improves architecture overall.

### 2.1 API Route Structure

```
/src/app/api/
  tasks/
    route.ts              # GET (list), POST (create)
    [id]/
      route.ts            # GET, PATCH, DELETE
      approve/
        route.ts          # POST - approve task
      resolve-blocker/
        route.ts          # POST - resolve blocker
  projects/
    route.ts              # GET (list), POST (create)
    [id]/
      route.ts            # GET, PATCH, DELETE
  activity/
    route.ts              # GET - activity feed
  simulation/
    route.ts              # POST - run simulation
```

### 2.2 Example API Routes

**File: `/src/app/api/tasks/route.ts`**

```typescript
import { createClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('projectId');
    const status = searchParams.get('status');

    let query = supabase
      .from('agent_tasks')
      .select('*, projects(id, name)')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (projectId) {
      query = query.eq('project_id', projectId);
    }
    if (status) {
      query = query.eq('status', status);
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();

    const { data, error } = await supabase
      .from('agent_tasks')
      .insert({ ...body, user_id: user.id })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

**File: `/src/app/api/tasks/[id]/route.ts`**

```typescript
import { createClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data, error } = await supabase
      .from('agent_tasks')
      .select('*, projects(id, name)')
      .eq('id', params.id)
      .eq('user_id', user.id)
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }

    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();

    const { data, error } = await supabase
      .from('agent_tasks')
      .update({ ...body, updated_at: new Date().toISOString() })
      .eq('id', params.id)
      .eq('user_id', user.id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { error } = await supabase
      .from('agent_tasks')
      .delete()
      .eq('id', params.id)
      .eq('user_id', user.id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

### 2.3 API Client

**File: `/src/lib/api-client.ts`**

```typescript
type FetchOptions = Omit<RequestInit, 'body'> & {
  body?: unknown;
};

class ApiClient {
  private baseUrl: string;

  constructor() {
    // Empty for same-origin (web), full URL for Electron
    this.baseUrl = process.env.NEXT_PUBLIC_API_URL || '';
  }

  private async fetch<T>(endpoint: string, options: FetchOptions = {}): Promise<T> {
    const { body, ...init } = options;

    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...init.headers,
      },
      credentials: 'include', // Important for auth cookies
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(error.error || `HTTP ${response.status}`);
    }

    if (response.status === 204) {
      return null as T;
    }

    return response.json();
  }

  // Tasks
  tasks = {
    list: (params?: { projectId?: string; status?: string }) => {
      const searchParams = new URLSearchParams();
      if (params?.projectId) searchParams.set('projectId', params.projectId);
      if (params?.status) searchParams.set('status', params.status);
      const query = searchParams.toString();
      return this.fetch<Task[]>(`/api/tasks${query ? `?${query}` : ''}`);
    },
    get: (id: string) => this.fetch<Task>(`/api/tasks/${id}`),
    create: (data: CreateTaskInput) => this.fetch<Task>('/api/tasks', { method: 'POST', body: data }),
    update: (id: string, data: UpdateTaskInput) => this.fetch<Task>(`/api/tasks/${id}`, { method: 'PATCH', body: data }),
    delete: (id: string) => this.fetch<void>(`/api/tasks/${id}`, { method: 'DELETE' }),
    approve: (id: string) => this.fetch<Task>(`/api/tasks/${id}/approve`, { method: 'POST' }),
    resolveBlocker: (id: string, response: string) =>
      this.fetch<Task>(`/api/tasks/${id}/resolve-blocker`, { method: 'POST', body: { response } }),
  };

  // Projects
  projects = {
    list: () => this.fetch<Project[]>('/api/projects'),
    get: (id: string) => this.fetch<Project>(`/api/projects/${id}`),
    create: (data: CreateProjectInput) => this.fetch<Project>('/api/projects', { method: 'POST', body: data }),
    update: (id: string, data: UpdateProjectInput) => this.fetch<Project>(`/api/projects/${id}`, { method: 'PATCH', body: data }),
    delete: (id: string) => this.fetch<void>(`/api/projects/${id}`, { method: 'DELETE' }),
  };

  // Activity
  activity = {
    list: (taskId?: string) => {
      const query = taskId ? `?taskId=${taskId}` : '';
      return this.fetch<ActivityEvent[]>(`/api/activity${query}`);
    },
  };
}

export const api = new ApiClient();

// Types (import from your existing types or define here)
import type { AgentTask as Task, Project, ActivityEvent } from '@/types/database';

type CreateTaskInput = Omit<Task, 'id' | 'user_id' | 'created_at' | 'updated_at'>;
type UpdateTaskInput = Partial<CreateTaskInput>;
type CreateProjectInput = Omit<Project, 'id' | 'user_id' | 'created_at' | 'updated_at'>;
type UpdateProjectInput = Partial<CreateProjectInput>;
```

### 2.4 CORS Middleware (for Electron)

**File: `/src/middleware.ts`** (update existing or create)

```typescript
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  // Handle CORS for API routes
  if (request.nextUrl.pathname.startsWith('/api/')) {
    const origin = request.headers.get('origin');

    // Allow requests from Electron (file://) and localhost
    const allowedOrigins = [
      'file://',
      'http://localhost:7000',
      'https://exawatt.ai',
    ];

    const response = NextResponse.next();

    if (origin && (allowedOrigins.includes(origin) || origin.startsWith('file://'))) {
      response.headers.set('Access-Control-Allow-Origin', origin);
      response.headers.set('Access-Control-Allow-Credentials', 'true');
      response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    }

    // Handle preflight
    if (request.method === 'OPTIONS') {
      return new NextResponse(null, { status: 200, headers: response.headers });
    }

    return response;
  }

  return NextResponse.next();
}

export const config = {
  matcher: '/api/:path*',
};
```

---

## Phase 3: Static Bundle

**Goal:** Bundle the React frontend into Electron for faster loading and native feel.

### 3.1 Environment Configuration

**File: `/.env.local`** (web - uses relative URLs)
```env
NEXT_PUBLIC_API_URL=
```

**File: `/.env.electron`** (electron build)
```env
NEXT_PUBLIC_API_URL=https://exawatt.ai
```

### 3.2 Conditional Next.js Export

**Update: `/next.config.ts`**

```typescript
import type { NextConfig } from 'next';

const isElectronBuild = process.env.ELECTRON_BUILD === 'true';

const nextConfig: NextConfig = {
  // Existing config...

  // Only use static export for Electron builds
  ...(isElectronBuild && {
    output: 'export',
    images: {
      unoptimized: true,
    },
    // Disable features incompatible with static export
    experimental: {
      // any experimental features
    },
  }),

  trailingSlash: true,
};

export default nextConfig;
```

### 3.3 Update Electron Main for Static Loading

**Update: `/electron/main/main.ts`**

```typescript
import { app, BrowserWindow, shell, Menu } from 'electron';
import path from 'path';

const isDev = process.env.NODE_ENV === 'development';
const DEV_URL = 'http://localhost:7000';

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: '#09090b',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  if (isDev) {
    mainWindow.loadURL(DEV_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    // Production: load static export
    mainWindow.loadFile(path.join(__dirname, '../out/index.html'));
  }

  // ... rest of the code
}
```

### 3.4 Updated Build Scripts

**Update: `/package.json`**

```json
{
  "scripts": {
    "electron:compile": "tsc -p electron/tsconfig.json",
    "electron:dev": "pnpm electron:compile && concurrently \"pnpm dev\" \"wait-on http://localhost:7000 && cross-env NODE_ENV=development electron .\"",
    "electron:export": "cross-env ELECTRON_BUILD=true next build",
    "electron:build": "pnpm electron:compile && pnpm electron:export && electron-builder --mac",
    "electron:build:dir": "pnpm electron:compile && pnpm electron:export && electron-builder --mac --dir"
  }
}
```

### 3.5 Update electron-builder.yml

```yaml
files:
  - dist-electron/**/*
  - out/**/*           # Static export output
  - "!node_modules/**/*"
```

### 3.6 Component Updates

Gradually update components to use the API client instead of server actions:

**Before:**
```typescript
// Using server action directly
import { getTasks } from '@/app/actions/tasks';

export default async function BoardPage() {
  const tasks = await getTasks();
  return <Board tasks={tasks} />;
}
```

**After:**
```typescript
// Using API client (works in both web and Electron)
'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api-client';

export default function BoardPage() {
  const [tasks, setTasks] = useState([]);

  useEffect(() => {
    api.tasks.list().then(setTasks);
  }, []);

  return <Board tasks={tasks} />;
}
```

Or use SWR/React Query for better caching:

```typescript
'use client';

import useSWR from 'swr';
import { api } from '@/lib/api-client';

export default function BoardPage() {
  const { data: tasks, error, isLoading } = useSWR('tasks', () => api.tasks.list());

  if (isLoading) return <Loading />;
  if (error) return <Error error={error} />;

  return <Board tasks={tasks} />;
}
```

---

## File Summary

### New Files to Create

| File | Phase | Purpose |
|------|-------|---------|
| `/electron/main/main.ts` | 1 | Main process entry |
| `/electron/main/preload.ts` | 1 | IPC preload script |
| `/electron/tsconfig.json` | 1 | TypeScript config |
| `/electron/entitlements.mac.plist` | 1 | macOS entitlements |
| `/electron/resources/icon.icns` | 1 | macOS app icon |
| `/electron-builder.yml` | 1 | Build configuration |
| `/src/types/electron.d.ts` | 1 | Electron type definitions |
| `/src/app/api/tasks/route.ts` | 2 | Tasks API endpoint |
| `/src/app/api/tasks/[id]/route.ts` | 2 | Single task endpoint |
| `/src/app/api/projects/route.ts` | 2 | Projects API endpoint |
| `/src/app/api/projects/[id]/route.ts` | 2 | Single project endpoint |
| `/src/app/api/activity/route.ts` | 2 | Activity API endpoint |
| `/src/lib/api-client.ts` | 2 | API client wrapper |
| `/src/middleware.ts` | 2 | CORS middleware |
| `/.env.electron` | 3 | Electron environment |

### Files to Modify

| File | Phase | Changes |
|------|-------|---------|
| `/package.json` | 1 | Add dependencies, scripts, main field |
| `/.gitignore` | 1 | Add electron build outputs |
| `/next.config.ts` | 3 | Add conditional static export |
| Components using server actions | 3 | Switch to API client |

---

## Implementation Order

### Phase 1 (Ship in 1-2 hours)
1. Install Electron dependencies
2. Create `/electron/main/main.ts`
3. Create `/electron/main/preload.ts`
4. Create `/electron/tsconfig.json`
5. Create `/electron-builder.yml`
6. Create `/electron/entitlements.mac.plist`
7. Update `/package.json`
8. Update `/.gitignore`
9. Create app icon (can use placeholder initially)
10. Test: `pnpm electron:dev`
11. Build: `pnpm electron:build`

### Phase 2 (1-2 days)
1. Create API routes for tasks
2. Create API routes for projects
3. Create API routes for activity
4. Create API client (`/src/lib/api-client.ts`)
5. Add CORS middleware
6. Test API routes work from browser

### Phase 3 (2-3 days)
1. Update `next.config.ts` for conditional export
2. Create `.env.electron`
3. Update electron main.ts to load static files
4. Update build scripts
5. Gradually migrate components to API client
6. Test full static bundle build
7. Verify auth works correctly

---

## Future Enhancements

- **Auto-updates:** Add `electron-updater` for automatic updates
- **Native notifications:** Use Electron's notification API
- **Deep linking:** Handle `exawatt://` URLs
- **System tray:** Quick access menu in system tray
- **Keyboard shortcuts:** Global shortcuts via Electron's accelerators
- **Offline support:** Cache data locally with sync
- **Windows/Linux:** Extend build config for other platforms

---

## Testing Checklist

### Phase 1
- [ ] `pnpm electron:dev` opens app and loads localhost
- [ ] App loads exawatt.ai in production build
- [ ] Authentication works
- [ ] All existing features work
- [ ] macOS traffic lights positioned correctly
- [ ] External links open in default browser
- [ ] DMG installs correctly

### Phase 2
- [ ] API routes return correct data
- [ ] Authentication required for all endpoints
- [ ] CORS allows Electron requests
- [ ] API client works in browser

### Phase 3
- [ ] Static export builds successfully
- [ ] Electron loads local files
- [ ] API calls reach exawatt.ai
- [ ] Auth cookies sent correctly
- [ ] All features work in static mode
