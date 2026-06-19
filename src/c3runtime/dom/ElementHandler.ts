"use strict";

{
  const GCORE_PLAYER_URL: string =
    "https://player.gvideo.co/v2/assets/latest/index.js";

  // Minimal surface of @gcorevideo/player's Player used by this plugin. The
  // real types come from the remote ES module loaded at runtime; we only model
  // the bits we call.
  interface GCorePlayer {
    attachTo(element: HTMLElement): void;
    play(): void;
    pause(): void;
    seek(time: number): void;
    setVolume(volume: number): void;
    getVolume(): number;
    getDuration(): number;
    mute(): void;
    unmute(): void;
    isMuted(): boolean;
    on(event: string, handler: (e: unknown) => void): void;
    destroy(): void;
  }

  interface GCorePlayerConstructor {
    new (config: unknown): GCorePlayer;
    registerPlugin(plugin: unknown): void;
  }

  // PlayerEvent enum values from @gcorevideo/player, inlined as string literals
  // so we don't depend on the enum being re-exported by the runtime bundle.
  const PlayerEvent = {
    Play: "play",
    Pause: "pause",
    Ended: "ended",
    Error: "error",
    Ready: "ready",
    TimeUpdate: "timeupdate",
    VolumeUpdate: "volumeupdate",
  } as const;

  // Shared, lazily-resolved module load. The remote build is an ES module with
  // named exports and no global, so we reach the Player constructor via a
  // dynamic import(). The browser module registry dedupes this against the
  // <script type="module"> that AddRemoteScriptDependency injects, so the
  // module is fetched and evaluated only once. Awaiting it before attachTo()
  // also guarantees Construct has already mounted our container <div>.
  let gcorePlayerPromise: Promise<GCorePlayerConstructor> | null = null;
  function loadGCorePlayer(): Promise<GCorePlayerConstructor> {
    if (gcorePlayerPromise === null) {
      gcorePlayerPromise = import(GCORE_PLAYER_URL).then((mod) => {
        const Player = mod["Player"] as GCorePlayerConstructor | undefined;
        if (!Player) {
          throw new Error("GCore Player export not found");
        }
        // SourceController drives manifest selection/transport; MediaControl is
        // the documented minimal companion plugin. Registration is global, so
        // it only needs to happen once for all element handlers.
        if (mod["SourceController"]) {
          Player.registerPlugin(mod["SourceController"]);
        }
        if (mod["MediaControl"]) {
          Player.registerPlugin(mod["MediaControl"]);
        }
        return Player;
      });
    }
    return gcorePlayerPromise;
  }

  class ElementHandler {
    element: HTMLElement;
    elementId: number;
    handler: IDOMElementHandler;
    player: GCorePlayer | null;
    currentUrl: string;
    controller: AbortController;

    constructor(
      element: HTMLElement,
      elementId: number,
      domHandler: IDOMElementHandler
    ) {
      this.element = element;
      this.elementId = elementId;
      this.handler = domHandler;
      this.player = null;
      this.currentUrl = "";
      this.controller = new AbortController();

      this.Setup();
    }

    Setup() {
      const { signal } = this.controller;

      // Keep player interactions inside the element so they don't leak into the
      // Construct game's input handling.
      const interactiveEvents = [
        "touchstart",
        "touchmove",
        "touchend",
        "mousedown",
        "mouseup",
        "keydown",
        "keyup",
        "click",
      ];
      interactiveEvents.map((e) =>
        this.element.addEventListener(e, (e) => e.stopPropagation(), { signal })
      );

      this.element.style.position = "absolute";
      this.element.style.border = "none";
      this.element.style.pointerEvents = "none";
    }

    PostToRuntime(event: string, data?: JSONValue) {
      this.handler.PostToRuntimeElement(event, this.elementId, data);
    }

    PostStateToRuntime(state: JSONObject) {
      this.PostToRuntime("state-changed", { state });
    }

    PostErrorToRuntime(category: string, message: string) {
      this.PostToRuntime("error", { error: { category, message } });
    }

    UpdateState(e: JSONObject) {
      let url = (e["url"] ?? "") as string;
      const language = (e["subtitles"] ?? "off") as string;
      const noLowLatency = e["noLowLatency"] || false;
      if (url !== "") {
        if (language !== "off") {
          url += "?sub_lang=" + language;
        }
        if (noLowLatency) {
          url += (url.includes("?") ? "&" : "?") + "no_low_latency";
        }
      }
      if (this.currentUrl !== url) {
        this.currentUrl = url;
        if (url !== "") {
          console.debug("Loading", url);
          this.PostStateToRuntime({ playerState: "loading" });
          this.CreatePlayer(url);
        } else {
          console.debug("Offloading video player");
          this.DestroyPlayer();
          this.PostStateToRuntime({ playerState: "offline" });
        }
      }
    }

    async CreatePlayer(url: string) {
      console.log("Setting up new player", url);

      let Player: GCorePlayerConstructor;
      try {
        Player = await loadGCorePlayer();
      } catch (err) {
        console.error("[video player] Failed to load GCore player", err);
        this.PostErrorToRuntime("gcore", `Failed to load player: ${err}`);
        return;
      }

      // A later UpdateState() may have changed or cleared the URL while we
      // awaited the module load; bail if this request is stale.
      if (this.currentUrl !== url) {
        return;
      }

      let manifestUrl: string;
      try {
        manifestUrl = await this.ResolveManifest(url);
      } catch (err) {
        console.error("[video player] Failed to resolve manifest", err);
        this.PostErrorToRuntime("gcore", `Could not resolve video manifest: ${err}`);
        return;
      }

      // ResolveManifest awaits a network fetch for embed URLs — re-check that
      // this request is still current before committing the player.
      if (this.currentUrl !== url) {
        return;
      }

      this.DestroyPlayer();

      const player = new Player({
        autoPlay: true,
        mute: true,
        sources: [{ source: manifestUrl, mimeType: this.GetMimeType(manifestUrl) }],
      });
      this.player = player;
      this.RegisterEvents(player);
      player.attachTo(this.element);
      console.log("Player created", player, "manifest:", manifestUrl);
    }

    // The v2 player needs a direct HLS manifest URL, but projects store GCore
    // *embed page* URLs (player.gvideo.co/videos|streams/<id>) — the kind the
    // old iframe plugin consumed. GCore serves the manifest from the account CDN
    // host derived from the client id (the numeric prefix of the video id):
    //   player.gvideo.co/videos/<clientId>_<tok>
    //     -> https://<clientId>.gvideo.io/videos/<clientId>_<tok>/master.m3u8
    // A URL that is already a manifest is returned unchanged; anything that
    // doesn't match the embed pattern falls back to reading the stream URL the
    // embed page itself uses (options.multisources[].source).
    async ResolveManifest(url: string): Promise<string> {
      if (/\.(m3u8|mpd)([?#]|$)/i.test(url)) {
        return url;
      }
      const path = url.split(/[?#]/)[0];
      const m = path.match(/\/(videos|streams)\/((\d+)_[^/]+?)\/?$/);
      if (m) {
        const [, kind, id, clientId] = m;
        return `https://${clientId}.gvideo.io/${kind}/${id}/master.m3u8`;
      }
      // Fallback for non-standard embed URLs: scrape the manifest the embed
      // page references directly.
      const resp = await fetch(url, { credentials: "omit" });
      if (!resp.ok) {
        throw new Error(`embed page HTTP ${resp.status}`);
      }
      const html = await resp.text();
      const src = html.match(/"source"\s*:\s*"([^"]+?\.(?:m3u8|mpd)[^"]*)"/i);
      if (!src) {
        throw new Error("could not resolve manifest from URL");
      }
      // Unescape any JSON-escaped slashes (e.g. "https:\/\/...").
      return src[1].replace(/\\\//g, "/");
    }

    GetMimeType(url: string) {
      // GCore manifest endpoints: .mpd is DASH, otherwise assume HLS (.m3u8).
      // Progressive/direct-file sources are not supported by this plugin.
      const path = url.split("?")[0].toLowerCase();
      if (path.endsWith(".mpd")) {
        return "application/dash+xml";
      }
      return "application/x-mpegurl";
    }

    RegisterEvents(player: GCorePlayer) {
      player.on(PlayerEvent.Error, (err) => {
        console.error("VideoPlayer API Error", err);
        const errObj = err as { message?: string } | null | undefined;
        const message = errObj?.message ?? String(err);
        this.PostErrorToRuntime("gcore", message);
      });

      player.on(PlayerEvent.Play, () => {
        console.log("[video player]", "Playing");
        this.PostStateToRuntime({ playerState: "playing" });
        // Play fires reliably; report duration/volume here so the runtime can
        // reach its "initialized" state even if Ready/VolumeUpdate don't fire
        // (e.g. VolumeUpdate is only emitted on a change, not for initial mute).
        this.PostPlaybackInfo(player);
      });

      player.on(PlayerEvent.Pause, () => {
        console.log("[video player]", "Paused");
        this.PostStateToRuntime({ playerState: "paused" });
      });

      player.on(PlayerEvent.TimeUpdate, (e) => {
        const { current, total } = e as { current?: number; total?: number };
        const state: JSONObject = {};
        if (typeof current === "number") {
          state.currentPlaybackTime = current;
        }
        // `total` is the stream duration — a reliable source even when the
        // Ready event's getDuration() isn't yet populated.
        if (typeof total === "number" && !isNaN(total)) {
          state.duration = total;
        }
        this.PostStateToRuntime(state);
      });

      player.on(PlayerEvent.VolumeUpdate, () => {
        this.PostStateToRuntime({
          currentVolume: player.getVolume(),
          audioState: player.isMuted() ? "muted" : "unmuted",
        });
      });

      player.on(PlayerEvent.Ended, () => {
        console.log("[video player]", "Ended");
        this.PostStateToRuntime({ playerState: "ended" });
      });

      player.on(PlayerEvent.Ready, () => {
        console.log("[video player]", "Ready");
        this.PostPlaybackInfo(player);
      });
    }

    // Report duration, volume and audio (mute) state together. Methods are
    // synchronous in the new API. getVolume() returns the actual level (0 when
    // muted), and mute is reported separately via audioState so the runtime can
    // distinguish "muted" from "volume happens to be 0".
    PostPlaybackInfo(player: GCorePlayer) {
      const state: JSONObject = {
        currentVolume: player.getVolume(),
        audioState: player.isMuted() ? "muted" : "unmuted",
      };
      const duration = player.getDuration();
      // Accept 0 and Infinity (live), but never NaN (would fail duration > -1).
      if (typeof duration === "number" && !isNaN(duration)) {
        state.duration = duration;
      }
      this.PostStateToRuntime(state);
    }

    DestroyPlayer() {
      if (this.player) {
        try {
          this.player.destroy();
        } catch (e) {
          console.warn("[video player] destroy failed", e);
        }
        this.player = null;
      }
    }

    Destroy() {
      // remove event listeners
      this.controller.abort();
      this.currentUrl = "";
      this.DestroyPlayer();
    }

    OnPlay() {
      console.log("[video player] Play requested");
      this.player?.play();
    }

    OnPause() {
      console.log("[video player] Pause requested");
      this.player?.pause();
    }

    OnSeek(state: JSONObject) {
      const time = state["requestedPlaybackTime"];
      console.log("[video player] Seek requested", time);
      if (typeof time === "number") {
        this.player?.seek(time);
      }
    }

    OnSetVolume(state: JSONObject) {
      const volume = state["requestedVolume"];
      console.log("[video player] Set volume requested", volume);
      if (typeof volume === "number") {
        this.player?.setVolume(volume);
      }
    }

    OnMute() {
      console.log("[video player]", "Mute requested");
      this.player?.mute();
      this.PostStateToRuntime({ audioState: "muted" });
    }

    OnUnmute() {
      console.log("[video player]", "Unmute requested");
      this.player?.unmute();
      this.PostStateToRuntime({ audioState: "unmuted" });
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).Genvidtech_GCoreVideoPlugin_ElementHandler =
    ElementHandler;
}
