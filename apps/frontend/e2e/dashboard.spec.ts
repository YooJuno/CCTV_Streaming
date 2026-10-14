import { expect, test, type Page } from "playwright/test";
import { readFileSync } from "node:fs";

const streams = [{ id: "mystream", name: "정문 카메라" }];
const auth = {
  expiresInSeconds: 3600,
  username: "viewer",
  displayName: "관제 담당자",
  streams,
};
const system = {
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
  streamDetails: [
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
  recommendations: ["All authorized streams are healthy."],
};
interface MockOptions {
  meStatus?: number;
  meBody?: object;
  loginStatus?: number;
  loginBody?: object;
  streamsBody?: object;
  systemStatus?: number;
  systemBody?: object;
}
async function installApiMocks(
  page: Page,
  options: MockOptions = {},
): Promise<void> {
  await page.route("**/api/devices/server-info", (route) => route.fulfill({ json: { serverUrl: "https://camera.example.test", requiresConfiguration: false } }));
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      status: options.meStatus ?? 401,
      json: options.meBody ?? { error: "unauthorized" },
    }),
  );
  await page.route("**/api/auth/login", (route) =>
    route.fulfill({
      status: options.loginStatus ?? 200,
      json: options.loginBody ?? auth,
    }),
  );
  await page.route("**/api/auth/logout", (route) =>
    route.fulfill({ status: 200, json: { status: "logged out" } }),
  );
  await page.route("**/api/streams", (route) =>
    route.fulfill({ status: 200, json: options.streamsBody ?? { streams } }),
  );
  await page.route("**/api/system/health", (route) =>
    route.fulfill({
      status: options.systemStatus ?? 200,
      json: options.systemBody ?? system,
    }),
  );
}

async function login(page: Page): Promise<void> {
  await page.getByLabel("아이디").fill("viewer");
  await page.getByLabel("비밀번호", { exact: true }).fill("viewer123");
  await page.getByRole("button", { name: /관제 시작하기/ }).click();
}

test("login, refresh and logout remain available", async ({ page }) => {
  await installApiMocks(page);
  await page.goto("/");
  await login(page);
  await expect(
    page.getByRole("heading", { name: "실시간 관제" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "정문 카메라" }),
  ).toBeVisible();
  const refresh = page.waitForRequest((request) =>
    request.url().endsWith("/api/streams"),
  );
  await page.getByRole("button", { name: "목록 새로고침" }).click();
  await refresh;
  await page.getByRole("button", { name: "로그아웃" }).click();
  await expect(page.getByLabel("아이디")).toBeVisible();
});

test("default live playback displays JPEG without HLS and releases its image on stop", async ({ page }) => {
  await installApiMocks(page);
  const jpeg = readFileSync("e2e/fixtures/frame.jpg");
  let manifests = 0;
  page.on("request", request => { if (request.url().endsWith(".m3u8")) manifests++; });
  await page.route("**/api/live/mystream/status", route => route.fulfill({json: {connected:true,frameAgeMs:10,receivedFps:8,bytesPerSecond:8192,sequence:1}}));
  await page.route("**/api/live/mystream/stream.mjpeg?*", route => route.fulfill({
    contentType: "multipart/x-mixed-replace; boundary=cctv-frame",
    body: Buffer.concat([Buffer.from(`--cctv-frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpeg.length}\r\n\r\n`), jpeg, Buffer.from("\r\n--cctv-frame--\r\n")]),
  }));
  await page.goto("/");
  await login(page);
  await page.getByRole("button", {name:"정문 카메라 영상 시작"}).click();
  const image = page.getByRole("img", {name:"mystream 실시간 영상"});
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate(element => (element as HTMLImageElement).naturalWidth)).toBe(32);
  expect(manifests).toBe(0);
  await expect(page.getByText("재생 중", {exact:true})).toBeVisible();
  await page.getByRole("button", {name:"정문 카메라 영상 중지"}).click();
  await expect(image).toHaveCount(0);
});

test("login failure is announced", async ({ page }) => {
  await installApiMocks(page, {
    loginStatus: 401,
    loginBody: { error: "invalid credentials" },
  });
  await page.goto("/");
  await login(page);
  await expect(page.getByRole("alert")).toContainText(/아이디|비밀번호|401/);
});

test("empty assignments explain the next action", async ({ page }) => {
  await installApiMocks(page, {
    meStatus: 200,
    meBody: { ...auth, streams: [] },
    streamsBody: { streams: [] },
    systemBody: {
      ...system,
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
  await expect(
    page.getByRole("heading", { name: "등록된 카메라가 없습니다" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "장비 설치 안내" }),
  ).toBeVisible();
});

test("unauthorized health expires the session", async ({ page }) => {
  await installApiMocks(page, {
    meStatus: 200,
    meBody: auth,
    systemStatus: 401,
    systemBody: { error: "unauthorized" },
  });
  await page.goto("/");
  await expect(page.getByLabel("아이디")).toBeVisible();
  await expect(page.getByRole("alert")).toContainText(
    /세션|다시 로그인|Session expired/,
  );
});

test("search and status filtering use real API camera states", async ({
  page,
}) => {
  const twoStreams = [...streams, { id: "lobby", name: "로비 카메라" }];
  await installApiMocks(page, {
    meStatus: 200,
    meBody: { ...auth, streams: twoStreams },
    streamsBody: { streams: twoStreams },
    systemBody: {
      ...system,
      streamDetails: [
        ...system.streamDetails,
        {
          ...system.streamDetails[0],
          id: "lobby",
          live: false,
          state: "OFFLINE",
          reason: "MANIFEST_MISSING",
          manifestExists: false,
          manifestAgeSeconds: -1,
          segmentCount: 0,
        },
      ],
    },
  });
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: /^오프라인\s*1$/, exact: true }),
  ).toBeVisible();
  await page.getByRole("searchbox", { name: "카메라 검색" }).fill("LOBBY");
  await expect(
    page.getByRole("heading", { name: "로비 카메라" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "정문 카메라" })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: /^정상\s*1$/, exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "조건에 맞는 카메라가 없습니다" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "검색과 필터 초기화" }).click();
  await expect(
    page.getByRole("heading", { name: "정문 카메라" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "로비 카메라" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "집중 보기" }).click();
  await expect(page.locator(".stream-grid")).toHaveClass(/focus-view/);
});

test("starting a camera loads its manifest and stopping releases video", async ({
  page,
}) => {
  await installApiMocks(page, { meStatus: 200, meBody: auth });
  let requests = 0;
  await page.route("**/hls/mystream.m3u8", (route) => {
    requests += 1;
    return requests === 1
      ? route.fulfill({ status: 404, body: "not generated" })
      : route.fulfill({
          status: 200,
          contentType: "application/vnd.apple.mpegurl",
          body: "#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:1\n#EXT-X-MEDIA-SEQUENCE:0\n#EXTINF:1,\nretry-segment.ts\n#EXT-X-ENDLIST\n",
        });
  });
  await page.route("**/hls/retry-segment.ts", (route) =>
    route.fulfill({ status: 404, body: "fixture segment unavailable" }),
  );
  await page.goto("/");
  await expect(page.locator("video")).toHaveCount(0);
  const manifest = page.waitForRequest((request) =>
    request.url().includes("/hls/mystream.m3u8"),
  );
  await page.getByRole("button", { name: "정문 카메라 영상 시작" }).click();
  await page.getByRole("button", { name: "호환 재생", exact: true }).click();
  await manifest;
  await expect(page.locator("video")).toHaveCount(1);
  await expect.poll(() => requests).toBeGreaterThanOrEqual(2);
  await page.getByRole("button", { name: "정문 카메라 영상 중지" }).click();
  await expect(page.locator("video")).toHaveCount(0);
  const countAtStop = requests;
  await page.waitForTimeout(1200);
  expect(requests).toBe(countAtStop);
});

test("mobile navigation supports keyboard and the dashboard has no overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await installApiMocks(page, { meStatus: 200, meBody: auth });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "정문 카메라" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  const menu = page.getByRole("button", { name: "메뉴 열기" });
  await menu.click();
  await expect(menu).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Escape");
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  await expect(menu).toBeFocused();
  await menu.click();
  await page.getByRole("button", { name: "시스템 상태", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "시스템 상태" }),
  ).toBeVisible();
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await menu.click();
  await page.getByRole("button", { name: "장비 설치", exact: true }).click();
  await expect(page.getByRole("heading", { name: "장비 설치" })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("camera settings send a PUT and report remote application", async ({
  page,
}) => {
  await installApiMocks(page, { meStatus: 200, meBody: auth });
  const settings = {
    fps: 6,
    frameSize: "VGA",
    jpegQuality: 20,
    adaptive: true,
    revision: 1,
  };
  let update: object | null = null;
  await page.route("**/api/devices/mystream/settings", async (route) => {
    if (route.request().method() === "PUT") {
      update = route.request().postDataJSON();
      await route.fulfill({ json: { ...update, revision: 2 } });
    } else await route.fulfill({ json: settings });
  });
  await page.goto("/");
  await page.locator(".stream-settings > summary").click();
  await page.getByLabel("송출 FPS").selectOption("10");
  await page.getByLabel("영상 해상도").selectOption("SVGA");
  await page.getByRole("button", { name: "설정 저장" }).click();
  await expect(page.getByText(/설정을 저장했습니다/)).toBeVisible();
  expect(update).toEqual({
    fps: 10,
    frameSize: "SVGA",
    jpegQuality: 20,
    adaptive: true,
  });
});
