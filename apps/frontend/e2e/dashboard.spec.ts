import { expect, test, type Page } from "playwright/test";

interface MockOptions {
  meStatus?: number;
  meBody?: object;
  loginStatus?: number;
  loginBody?: object;
  streamsStatus?: number;
  streamsBody?: object;
  healthStatus?: number;
  healthBody?: object;
  systemStatus?: number;
  systemBody?: object;
}

async function installApiMocks(page: Page, options: MockOptions): Promise<void> {
  await page.route("**/api/auth/me", async (route) => {
    await route.fulfill({
      status: options.meStatus ?? 401,
      contentType: "application/json",
      body: JSON.stringify(options.meBody ?? { error: "unauthorized" }),
    });
  });

  await page.route("**/api/auth/login", async (route) => {
    await route.fulfill({
      status: options.loginStatus ?? 200,
      contentType: "application/json",
      body: JSON.stringify(
        options.loginBody ?? {
          expiresInSeconds: 3600,
          username: "viewer",
          displayName: "Viewer",
          streams: [{ id: "mystream", name: "Main Entrance" }],
        },
      ),
    });
  });

  await page.route("**/api/auth/logout", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status: "logged out" }),
    });
  });

  await page.route("**/api/streams", async (route) => {
    await route.fulfill({
      status: options.streamsStatus ?? 200,
      contentType: "application/json",
      body: JSON.stringify(
        options.streamsBody ?? {
          streams: [{ id: "mystream", name: "Main Entrance" }],
        },
      ),
    });
  });

  await page.route("**/api/streams/health", async (route) => {
    await route.fulfill({
      status: options.healthStatus ?? 200,
      contentType: "application/json",
      body: JSON.stringify(
        options.healthBody ?? {
          streams: [
            {
              id: "mystream",
              live: true,
              manifestExists: true,
              lastModifiedEpochMs: Date.now(),
              manifestAgeSeconds: 1,
              state: "LIVE",
              reason: "OK",
              segmentCount: 3,
              targetDurationSeconds: 1,
              endList: false,
              latestSegmentExists: true,
              latestSegmentSizeBytes: 1000,
            },
          ],
          liveThresholdSeconds: 12,
          recommendedPollMs: 4000,
          generatedAtEpochMs: Date.now(),
        },
      ),
    });
  });

  await page.route("**/api/system/health", async (route) => {
    await route.fulfill({
      status: options.systemStatus ?? 200,
      contentType: "application/json",
      body: JSON.stringify(
        options.systemBody ?? {
          generatedAtEpochMs: Date.now(),
          username: "viewer",
          hlsStorage: {
            path: "/tmp/hls",
            exists: true,
            readable: true,
            writable: true,
            manifestCount: 1,
            segmentCount: 3,
          },
          streams: {
            total: 1,
            live: 1,
            starting: 0,
            stale: 0,
            offline: 0,
            error: 0,
            reasons: { OK: 1 },
          },
          streamDetails: [],
          recommendations: ["All authorized streams are healthy."],
        },
      ),
    });
  });
}

test("login success renders dashboard", async ({ page }) => {
  await installApiMocks(page, {
    meStatus: 401,
    meBody: { error: "unauthorized" },
  });

  await page.goto("/");

  await page.getByLabel("Username").fill("viewer");
  await page.getByLabel("Password").fill("viewer123");
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByText("Signed in as Viewer")).toBeVisible();
  await expect(page.getByText("Main Entrance")).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh Streams" })).toBeVisible();
});

test("login failure shows error", async ({ page }) => {
  await installApiMocks(page, {
    meStatus: 401,
    meBody: { error: "unauthorized" },
    loginStatus: 401,
    loginBody: { error: "invalid credentials" },
  });

  await page.goto("/");
  await page.getByLabel("Username").fill("viewer");
  await page.getByLabel("Password").fill("bad");
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByText(/HTTP 401/i)).toBeVisible();
});

test("empty stream assignments show empty-state", async ({ page }) => {
  await installApiMocks(page, {
    meStatus: 200,
    meBody: {
      expiresInSeconds: 3600,
      username: "viewer",
      displayName: "Viewer",
      streams: [],
    },
    streamsBody: { streams: [] },
    healthBody: {
      streams: [],
      liveThresholdSeconds: 12,
      recommendedPollMs: 4000,
      generatedAtEpochMs: Date.now(),
    },
    systemBody: {
      generatedAtEpochMs: Date.now(),
      username: "viewer",
      hlsStorage: {
        path: "/tmp/hls",
        exists: true,
        readable: true,
        writable: true,
        manifestCount: 0,
        segmentCount: 0,
      },
      streams: {
        total: 0,
        live: 0,
        starting: 0,
        stale: 0,
        offline: 0,
        error: 0,
        reasons: {},
      },
      streamDetails: [],
      recommendations: ["No authorized streams for this account."],
    },
  });

  await page.goto("/");

  await expect(page.getByText("No stream assignments for this account.")).toBeVisible();
});

test("health unauthorized expires session", async ({ page }) => {
  await installApiMocks(page, {
    meStatus: 200,
    meBody: {
      expiresInSeconds: 3600,
      username: "viewer",
      displayName: "Viewer",
      streams: [{ id: "mystream", name: "Main Entrance" }],
    },
    healthStatus: 401,
    healthBody: { error: "unauthorized" },
    systemStatus: 200,
  });

  await page.goto("/");

  await expect(page.getByText("Session expired. Please sign in again.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
});
