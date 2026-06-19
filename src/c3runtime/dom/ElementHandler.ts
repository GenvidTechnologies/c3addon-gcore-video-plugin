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
    resize(size: { width: number; height: number }): void;
    on(event: string, handler: (e: unknown) => void): void;
    destroy(): void;
    // The GCore Player is a thin wrapper; the underlying Clappr player — with the
    // core, active playback and subtitle/track API — lives at `.player`. The
    // wrapper itself exposes no caption API, so subtitles must go through here.
    player?: {
      core?: {
        activePlayback?: ClapprPlayback;
      };
    };
  }

  // The active playback (e.g. the HLS backend). Subtitle tracks are loaded via
  // setTextTrack(id) — which sets hls.subtitleTrack and fetches the VTT — not via
  // closedCaptionsTrackId, which is a no-op on the HLS playback.
  interface ClapprPlayback {
    name?: string;
    setTextTrack?: (id: number) => void;
    closedCaptionsTrackId?: number;
    closedCaptionsTracks?: Array<{
      id: number;
      name?: string;
      label?: string;
      track?: { id?: number; label?: string; language?: string };
    }>;
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
        // ClosedCaptions enables subtitle rendering/selection from the in-manifest
        // subtitle tracks (GCore HLS exposes them as EXT-X-MEDIA SUBTITLES).
        if (mod["ClosedCaptions"]) {
          Player.registerPlugin(mod["ClosedCaptions"]);
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
    subtitleLang: string;
    // hls.js resets subtitle selections made during startup, so we defer
    // applying subtitles until playback has advanced ~2s past its start.
    playbackStable: boolean;
    playbackBaseline: number;
    // Audio is muted only for the very first autoplay (browser policy); after
    // that we carry the mute/volume state across video changes.
    lastMuted: boolean;
    lastVolume: number;
    resizeObserver: ResizeObserver | null;
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
      this.subtitleLang = "off";
      this.playbackStable = false;
      this.playbackBaseline = -1;
      this.lastMuted = true;
      this.lastVolume = -1;
      this.resizeObserver = null;
      this.controller = new AbortController();

      this.Setup();
    }

    Setup() {
      const { signal } = this.controller;

      // Eagerly load the player module so the runtime can report the API as
      // initialized (loaded) even before a video URL is set.
      loadGCorePlayer()
        .then(() => this.PostStateToRuntime({ apiInitialized: true }))
        .catch((err) =>
          console.error("[video player] Failed to load GCore player", err)
        );

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
      const url = (e["url"] ?? "") as string;
      // Subtitles are selected via the player's closed-caption tracks (not a URL
      // query param anymore — see ApplySubtitles).
      this.subtitleLang = (e["subtitles"] ?? "off") as string;
      // noLowLatency no longer maps to a URL param under the v2 player; proper
      // low-latency config is a follow-up (GitHub issue #1).

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
      } else {
        // URL unchanged (e.g. only the subtitle language changed) — apply it to
        // the existing player without rebuilding it.
        this.ApplySubtitles();
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

      // Reset playback-stability tracking for the new video.
      this.playbackStable = false;
      this.playbackBaseline = -1;

      const player = new Player({
        autoPlay: true,
        // Only the first autoplay needs forced mute; subsequent loads keep the
        // user's mute state.
        mute: this.lastMuted,
        sources: [{ source: manifestUrl, mimeType: this.GetMimeType(manifestUrl) }],
        playback: {
          // The player defaults hls.js to non-native subtitle rendering, whose
          // custom renderer doesn't display our selected track. Force native
          // text-track rendering so the browser renders cues for the track we
          // mark "showing" via closedCaptionsTrackId. hlsjsConfig takes priority.
          hlsjsConfig: { renderTextTracksNatively: true },
        },
      });
      this.player = player;
      this.RegisterEvents(player);
      player.attachTo(this.element);
      // Size the player to the Construct-managed container, and keep it in sync
      // when the instance is resized (Construct resizes our <div>, but the
      // player won't follow on its own).
      this.ResizePlayer();
      this.resizeObserver?.disconnect();
      this.resizeObserver = new ResizeObserver(() => this.ResizePlayer());
      this.resizeObserver.observe(this.element);
      console.log("Player created", player, "manifest:", manifestUrl);
    }

    ResizePlayer() {
      if (!this.player) {
        return;
      }
      const width = this.element.clientWidth;
      const height = this.element.clientHeight;
      if (width > 0 && height > 0) {
        this.player.resize({ width, height });
      }
    }

    // Select the subtitle track matching the requested language ("off"/unknown
    // disables). Tracks live on the underlying Clappr playback (player.player.
    // core.activePlayback) and are loaded via setTextTrack(id), which sets
    // hls.subtitleTrack and fetches the VTT.
    //
    // Selecting a language is deferred until playback is stable (see the
    // TimeUpdate handler): hls.js discards a subtitle selection made during
    // startup. Disabling ("off") works at any time. A language change after
    // playback is already stable applies immediately.
    ApplySubtitles() {
      const playback = this.player?.player?.core?.activePlayback;
      if (!playback) {
        return;
      }
      const lang = (this.subtitleLang || "off").toLowerCase();

      if (lang === "off") {
        this.SelectTextTrack(playback, -1);
        return;
      }
      if (!this.playbackStable) {
        // The TimeUpdate handler re-invokes ApplySubtitles once stable.
        return;
      }

      const tracks = playback.closedCaptionsTracks || [];
      const match = tracks.find((t) => {
        const fields = [t.track?.language, t.name, t.label, t.track?.label]
          .filter(Boolean)
          .map((s) => String(s).toLowerCase());
        return fields.some((f) => f === lang || f.startsWith(lang));
      });
      if (!match) {
        console.warn("[video player] No subtitle track for", lang, "available:", tracks);
        this.SelectTextTrack(playback, -1);
        return;
      }
      this.SelectTextTrack(playback, match.id);
    }

    SelectTextTrack(playback: ClapprPlayback, trackId: number) {
      if (typeof playback.setTextTrack === "function") {
        playback.setTextTrack(trackId);
      } else if (playback.closedCaptionsTrackId !== undefined) {
        playback.closedCaptionsTrackId = trackId;
      }
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
          // Once playback has advanced ~2s past its start, hls.js has settled and
          // a subtitle selection will stick. Apply any pending subtitle then.
          if (this.playbackBaseline < 0) {
            this.playbackBaseline = current;
          }
          if (!this.playbackStable && current - this.playbackBaseline >= 2) {
            this.playbackStable = true;
            this.ApplySubtitles();
          }
        }
        // `total` is the stream duration — a reliable source even when the
        // Ready event's getDuration() isn't yet populated.
        if (typeof total === "number" && !isNaN(total)) {
          state.duration = total;
        }
        this.PostStateToRuntime(state);
      });

      player.on(PlayerEvent.VolumeUpdate, () => {
        // Remember the latest audio state so it carries to the next video.
        this.lastMuted = player.isMuted();
        this.lastVolume = player.getVolume();
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
        // Restore the prior volume level on a subsequent (unmuted) load.
        if (!this.lastMuted && this.lastVolume >= 0) {
          player.setVolume(this.lastVolume);
        }
        this.PostPlaybackInfo(player);
        // Subtitle tracks are known once the manifest is parsed (by Ready).
        this.ApplySubtitles();
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
      this.resizeObserver?.disconnect();
      this.resizeObserver = null;
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
        this.lastVolume = volume;
        this.player?.setVolume(volume);
      }
    }

    OnMute() {
      console.log("[video player]", "Mute requested");
      this.lastMuted = true;
      this.player?.mute();
      this.PostStateToRuntime({ audioState: "muted" });
    }

    OnUnmute() {
      console.log("[video player]", "Unmute requested");
      this.lastMuted = false;
      this.player?.unmute();
      this.PostStateToRuntime({ audioState: "unmuted" });
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).Genvidtech_GCoreVideoPlugin_ElementHandler =
    ElementHandler;
}
