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
        // Retrieve a registered Clappr plugin by name (e.g. 'media_control').
        getPlugin?: (name: string) => ClapprPlugin | undefined | null;
        // Fallback: the list of registered plugin instances.
        plugins?: ClapprPlugin[];
      };
    };
  }

  // Minimal interface for a Clappr plugin. MediaControl exposes enable()/disable()
  // to show/hide the control bar without a player rebuild.
  interface ClapprPlugin {
    name?: string;
    enable?(): void;
    disable?(): void;
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
    // ABR quality levels (HLS renditions). currentLevel is readable/writable:
    // -1 = auto/ABR, otherwise the level index.
    levels?: Array<{ level: number; width: number; height: number; bitrate: number; codec?: string }>;
    currentLevel?: number;
    // DVR support: public boolean getter — false on VOD (docs/gcore-player-api.md A6).
    dvrEnabled?: boolean;
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
    noLowLatency: boolean;
    enableChrome: boolean;
    enableDvr: boolean;
    fallbackUrls: string[];
    subtitleSources: Array<{ url: string; language: string; label: string }>;
    // Track the last quality level reported to the runtime so we only post
    // currentQuality on a TimeUpdate when it actually changed (no quality event).
    lastReportedLevel: number;
    // Snapshot of the last DVR state posted to the runtime, used in TimeUpdate
    // to suppress redundant bridge posts when the window hasn't changed.
    // Mirror of lastReportedLevel, but for DVR window data.
    lastDvr: { isDvr: boolean; seekableStart: number; seekableEnd: number };
    // JSON snapshot of the last subtitle track list posted to the runtime.
    // Used in Ready and TimeUpdate to suppress redundant bridge posts when the
    // list hasn't changed (mirrors lastReportedLevel / lastDvr pattern).
    lastSubtitleTracksJson: string;
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
      this.noLowLatency = false;
      this.enableChrome = false;
      this.enableDvr = false;
      this.fallbackUrls = [];
      this.subtitleSources = [];
      this.lastReportedLevel = -2; // sentinel: "not yet reported"
      this.lastDvr = { isDvr: false, seekableStart: 0, seekableEnd: -1 };
      this.lastSubtitleTracksJson = "";
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
      const noLowLatency = (e["noLowLatency"] ?? false) as boolean;
      this.enableChrome = (e["enableChrome"] ?? false) as boolean;
      const enableDvr = (e["enableDvr"] ?? false) as boolean;
      const fallbackUrls = (e["fallbackUrls"] ?? []) as string[];
      const subtitleSources = (e["subtitleSources"] ?? []) as Array<{ url: string; language: string; label: string }>;

      if (this.NeedsRebuild({ url, noLowLatency, enableDvr, fallbackUrls, subtitleSources })) {
        this.noLowLatency = noLowLatency;
        this.enableDvr = enableDvr;
        this.fallbackUrls = fallbackUrls;
        this.subtitleSources = subtitleSources;
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
        // A live chrome toggle (no URL change) takes effect immediately.
        this.ApplyChrome();
      }
    }

    // Central seam for deciding whether an incoming state update requires
    // tearing down and rebuilding the player. Construction-time config toggles
    // (latency mode, etc.) extend this by adding fields to `next` and comparing
    // them against current state here. Subtitle-only changes take the light path
    // (no rebuild) — they are applied to the existing player via ApplySubtitles.
    private NeedsRebuild(next: { url: string; noLowLatency: boolean; enableDvr: boolean; fallbackUrls: string[]; subtitleSources: Array<{ url: string; language: string; label: string }> }): boolean {
      if (this.currentUrl !== next.url) return true;
      // Construction-time config changes below are only meaningful when a URL is
      // set (no point rebuilding an idle player).
      if (next.url !== "") {
        if (this.noLowLatency !== next.noLowLatency) return true;
        if (this.enableDvr !== next.enableDvr) return true;
        if (JSON.stringify(this.fallbackUrls) !== JSON.stringify(next.fallbackUrls)) return true;
        if (JSON.stringify(this.subtitleSources) !== JSON.stringify(next.subtitleSources)) return true;
      }
      return false;
    }

    // Constructs the config object passed to the Player constructor. Reads
    // current instance state (e.g. lastMuted, noLowLatency) and the pre-resolved
    // sources array. Extracted as a seam so construction-time config (quality,
    // latency, etc.) is layered here without touching CreatePlayer.
    private BuildPlayerConfig(sources: Array<{ source: string; mimeType: string }>): unknown {
      // hls.js config applied at construction time. lowLatencyMode is the
      // verified-reliable knob for disabling HLS low-latency mode; the GCore
      // playbackType/priorityTransport keys were evaluated but could not be
      // confirmed to change behavior on a VOD stream (see docs/gcore-player-api.md).
      // Full effect verification against a live low-latency stream is pending.
      const hlsjsConfig: Record<string, unknown> = {
        // The player defaults hls.js to non-native subtitle rendering, whose
        // custom renderer doesn't display our selected track. Force native
        // text-track rendering so the browser renders cues for the track we
        // mark "showing" via closedCaptionsTrackId. hlsjsConfig takes priority.
        renderTextTracksNatively: true,
      };
      if (this.noLowLatency) {
        // Disable hls.js low-latency mode; set only when requested so the
        // player default (true) is preserved for normal streams.
        hlsjsConfig.lowLatencyMode = false;
      }

      // Side-loaded (API-injected) external subtitle tracks. Clappr's HTML5
      // playback wires these via _setupExternalTracks(options.playback.externalTracks)
      // at construction time, so they appear in closedCaptionsTracks alongside
      // any in-manifest tracks — ApplySubtitles/SelectTextTrack then picks them
      // up unchanged via the usual language-matching path.
      //
      // VERIFIED (docs/gcore-player-api.md D4): the { kind, src, label, lang }
      // shape loads correctly, BUT the resulting track is a native
      // <video><track> only — it does NOT appear in hls.js closedCaptionsTracks.
      // ApplySubtitles therefore selects external tracks via the native
      // textTrack.mode (SetExternalTrackMode), not setTextTrack(). Use a language
      // tag distinct from the in-manifest ones (e.g. "en-ext") so it isn't
      // shadowed by an in-manifest track of the same language.
      const playback: Record<string, unknown> = { hlsjsConfig };
      if (this.subtitleSources.length > 0) {
        playback.externalTracks = this.subtitleSources.map((s) => ({
          kind: "subtitles",
          src: s.url,
          label: s.label,
          lang: s.language,
        }));
      }

      const config: Record<string, unknown> = {
        autoPlay: true,
        // Only the first autoplay needs forced mute; subsequent loads keep the
        // user's mute state.
        mute: this.lastMuted,
        sources,
        playback,
      };

      if (this.enableDvr) {
        // DVR mode opt-in: sets playbackType to "dvr" so the player enables the
        // seekable live window. Effect unverified against a live DVR stream
        // (docs/gcore-player-api.md A6).
        config.playbackType = "dvr";
      }

      return config;
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

      // Resolve the primary URL and all fallback URLs concurrently. The primary
      // must succeed; fallback resolution failures are swallowed so a bad
      // fallback URL doesn't block the primary from loading.
      const allUrls = [url, ...this.fallbackUrls];
      let resolved: string[];
      try {
        resolved = await Promise.all(
          allUrls.map((u, i) =>
            this.ResolveManifest(u).catch((err) => {
              if (i === 0) throw err; // primary failure is fatal
              console.warn("[video player] Failed to resolve fallback manifest", u, err);
              return null as unknown as string;
            })
          )
        );
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

      // Build the sources array from successfully-resolved URLs (skip nulls from
      // failed fallback resolutions).
      const sources = resolved
        .filter((s): s is string => s != null)
        .map((s) => ({ source: s, mimeType: this.GetMimeType(s) }));

      this.DestroyPlayer();

      // Reset playback-stability tracking for the new video.
      this.playbackStable = false;
      this.playbackBaseline = -1;
      // Reset subtitle-track change-guard so the new video re-posts its list.
      // Mirrors lastReportedLevel reset for quality.
      this.lastSubtitleTracksJson = "";

      const player = new Player(this.BuildPlayerConfig(sources));
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
      console.log("Player created", player, "sources:", sources);
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
        this.SetExternalTrackMode(null);
        return;
      }

      // Side-loaded (API-injected) tracks are native <video><track> elements:
      // they appear in <video>.textTracks but NOT in hls.js closedCaptionsTracks,
      // so they're selected by toggling the native textTrack.mode rather than
      // setTextTrack(). They exist from construction, so unlike in-manifest tracks
      // they can be applied immediately (no playback-stable wait). Try them first.
      const externalLangs = this.subtitleSources.map((s) => s.language.toLowerCase());
      if (externalLangs.includes(lang)) {
        this.SelectTextTrack(playback, -1); // clear any in-manifest selection
        this.SetExternalTrackMode(lang);
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
        this.SetExternalTrackMode(null);
        return;
      }
      this.SelectTextTrack(playback, match.id);
      this.SetExternalTrackMode(null); // an in-manifest track won — hide externals
    }

    // Show the side-loaded external native textTrack whose language matches
    // `targetLang` (lowercased), disabling our other external tracks. Pass null
    // to disable all external tracks. Only touches tracks whose language is one
    // of our subtitleSources languages, so hls.js-managed in-manifest native
    // tracks are left under hls.js control (selected via setTextTrack).
    private SetExternalTrackMode(targetLang: string | null) {
      if (this.subtitleSources.length === 0) {
        return;
      }
      const video = this.element.querySelector("video") as HTMLVideoElement | null;
      if (!video) {
        return;
      }
      const externalLangs = new Set(this.subtitleSources.map((s) => s.language.toLowerCase()));
      for (const track of Array.from(video.textTracks)) {
        const tl = (track.language || "").toLowerCase();
        if (!externalLangs.has(tl)) {
          continue; // in-manifest track — leave it to hls.js
        }
        track.mode = targetLang !== null && tl === targetLang ? "showing" : "disabled";
      }
    }

    private ApplyChrome() {
      const core = this.player?.player?.core;
      if (!core) {
        return;
      }
      // Prefer the typed getPlugin() accessor; fall back to scanning the plugins
      // array for implementations that don't expose getPlugin.
      const mediaControl: ClapprPlugin | undefined | null =
        core.getPlugin?.("media_control") ??
        core.plugins?.find((p) => p.name === "media_control");

      if (!mediaControl) {
        console.warn("[video player] media_control plugin not found; cannot toggle chrome");
        return;
      }

      if (this.enableChrome) {
        mediaControl.enable?.();
      } else {
        mediaControl.disable?.();
      }
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
    // host derived from the client id (the numeric prefix of the video id). The
    // CDN path differs by kind: VOD lives under "videos/", but LIVE streams are
    // served under "cmaf/" (NOT "streams/"):
    //   player.gvideo.co/videos/<clientId>_<tok>
    //     -> https://<clientId>.gvideo.io/videos/<clientId>_<tok>/master.m3u8
    //   player.gvideo.co/streams/<clientId>_<tok>
    //     -> https://<clientId>.gvideo.io/cmaf/<clientId>_<tok>/master.m3u8
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
        // Live ("streams/" embed) manifests are served from the CDN "cmaf/" path.
        const cdnPath = kind === "streams" ? "cmaf" : kind;
        return `https://${clientId}.gvideo.io/${cdnPath}/${id}/master.m3u8`;
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
        // Poll ABR quality level on each TimeUpdate (no quality-change event).
        // Only post when the level actually changed to avoid spamming the bridge.
        const activePlayback = player.player?.core?.activePlayback;
        if (activePlayback !== undefined) {
          const currentQuality = activePlayback.currentLevel ?? -1;
          if (currentQuality !== this.lastReportedLevel) {
            this.lastReportedLevel = currentQuality;
            state.currentQuality = currentQuality;
          }
        }
        this.PostStateToRuntime(state);

        // Poll the DVR window on each TimeUpdate — the live window grows over
        // time. Only post when it changed to avoid spamming the bridge.
        const dvr = this.ReadDvrState(player);
        if (
          dvr.isDvr !== this.lastDvr.isDvr ||
          dvr.seekableStart !== this.lastDvr.seekableStart ||
          dvr.seekableEnd !== this.lastDvr.seekableEnd
        ) {
          this.lastDvr = dvr;
          this.PostStateToRuntime(dvr);
        }

        // Poll subtitle tracks on each TimeUpdate — in-manifest tracks populate
        // ~0.2s after Ready. The change-guard in PostSubtitleTracks prevents
        // bridge spam when the list is stable.
        this.PostSubtitleTracks();
      });

      player.on(PlayerEvent.VolumeUpdate, () => {
        // Remember the latest audio state so it carries to the next video.
        this.lastMuted = player.isMuted();
        // player API is 0..100 (docs/gcore-player-api.md A3); convert to 0..1
        // for the runtime/ACE layer. lastVolume is kept in 0..1 units.
        this.lastVolume = player.getVolume() / 100;
        this.PostStateToRuntime({
          // player API is 0..100; divide by 100 to report 0..1 to the runtime.
          currentVolume: player.getVolume() / 100,
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
        // lastVolume is in 0..1; multiply by 100 because the player API is
        // 0..100 (docs/gcore-player-api.md A3).
        if (!this.lastMuted && this.lastVolume >= 0) {
          player.setVolume(this.lastVolume * 100);
        }
        this.PostPlaybackInfo(player);
        // Subtitle tracks are known once the manifest is parsed (by Ready).
        this.ApplySubtitles();
        // Post the subtitle track list now that in-manifest tracks are available.
        // PostSubtitleTracks is also called on each TimeUpdate because in-manifest
        // tracks may populate ~0.2s after Ready; the change-guard prevents spam.
        this.PostSubtitleTracks();
        // Apply the initial/post-rebuild chrome (control bar) state now that
        // plugins are live and the media_control plugin is available.
        this.ApplyChrome();
        // Quality levels are available after manifest parse; report them now.
        const activePlayback = player.player?.core?.activePlayback;
        const qualityCount = activePlayback?.levels?.length ?? 0;
        const currentQuality = activePlayback?.currentLevel ?? -1;
        this.lastReportedLevel = currentQuality;
        this.PostStateToRuntime({ qualityCount, currentQuality });
        // Post initial DVR state once the manifest is parsed and the player is
        // ready. The seekable window (if any) should be known at this point.
        // PostDvrState also updates lastDvr so TimeUpdate suppression stays in sync.
        this.PostDvrState(player);
      });
    }

    // Report duration, volume and audio (mute) state together. Methods are
    // synchronous in the new API. getVolume() returns the actual level (0 when
    // muted), and mute is reported separately via audioState so the runtime can
    // distinguish "muted" from "volume happens to be 0".
    PostPlaybackInfo(player: GCorePlayer) {
      const state: JSONObject = {
        // player API is 0..100 (docs/gcore-player-api.md A3); divide by 100
        // to report 0..1 to the runtime/ACE layer.
        currentVolume: player.getVolume() / 100,
        audioState: player.isMuted() ? "muted" : "unmuted",
      };
      const duration = player.getDuration();
      // Accept 0 and Infinity (live), but never NaN (would fail duration > -1).
      if (typeof duration === "number" && !isNaN(duration)) {
        state.duration = duration;
      }
      this.PostStateToRuntime(state);
    }

    // Read DVR state from the underlying Clappr playback. `dvrEnabled` is a
    // public boolean getter (false on VOD). The seekable-window boundaries live
    // in PRIVATE fields with no public accessor — we read them defensively
    // through a loose cast.
    //
    // IMPORTANT: The private-field reads (_playableRegionStartTime,
    // _playableRegionDuration) are fragile and pending verification against a
    // real DVR stream (docs/gcore-player-api.md A6). They may break on a future
    // player update.
    private ReadDvrState(player: GCorePlayer): { isDvr: boolean; seekableStart: number; seekableEnd: number } {
      const ap = player.player?.core?.activePlayback;
      const isDvr = ap?.dvrEnabled ?? false;

      // Read private fields defensively — no public seekable-range API exists.
      // Cast through Record<string, unknown> to avoid any TS property-access error.
      const apAny = ap as unknown as Record<string, unknown> | undefined;
      const start =
        typeof apAny?.["_playableRegionStartTime"] === "number"
          ? (apAny["_playableRegionStartTime"] as number)
          : 0;
      const dur =
        typeof apAny?.["_playableRegionDuration"] === "number"
          ? (apAny["_playableRegionDuration"] as number)
          : -1;
      return { isDvr, seekableStart: start, seekableEnd: dur >= 0 ? start + dur : -1 };
    }

    // Post the current DVR state unconditionally (used from Ready). Also updates
    // `lastDvr` so the TimeUpdate change-suppression stays in sync.
    private PostDvrState(player: GCorePlayer) {
      const dvr = this.ReadDvrState(player);
      this.lastDvr = dvr;
      this.PostStateToRuntime(dvr);
    }

    // Build the combined subtitle track list: external (side-loaded) tracks
    // first, then in-manifest tracks from the Clappr active playback.
    // External tracks precede in-manifest so their index is stable regardless
    // of whether the manifest has loaded yet.
    private BuildSubtitleTrackList(): Array<{ language: string; label: string }> {
      const closedCaptionsTracks =
        this.player?.player?.core?.activePlayback?.closedCaptionsTracks;
      return [
        ...this.subtitleSources.map((s) => ({
          language: s.language,
          label: s.label,
        })),
        ...(closedCaptionsTracks ?? []).map((t) => ({
          language: t.track?.language ?? t.name ?? "",
          label: t.name ?? t.track?.label ?? "",
        })),
      ];
    }

    // Post the subtitle track list to the runtime when it has changed.
    // Uses JSON serialisation as a change-guard to avoid spamming the bridge
    // (mirrors lastReportedLevel for quality and lastDvr for DVR window data).
    private PostSubtitleTracks() {
      const list = this.BuildSubtitleTrackList();
      const json = JSON.stringify(list);
      if (json === this.lastSubtitleTracksJson) {
        return;
      }
      this.lastSubtitleTracksJson = json;
      this.PostStateToRuntime({ subtitleTracks: list });
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
        // ACE/runtime value is 0..1; keep lastVolume in 0..1 units.
        this.lastVolume = volume;
        // player API is 0..100 (docs/gcore-player-api.md A3); multiply by 100.
        this.player?.setVolume(volume * 100);
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

    OnSetQuality(state: JSONObject) {
      const level = state["level"];
      console.log("[video player] Set quality requested", level);
      if (typeof level !== "number") {
        return;
      }
      const activePlayback = this.player?.player?.core?.activePlayback;
      if (activePlayback === undefined || activePlayback === null) {
        console.warn("[video player] Cannot set quality: activePlayback not available");
        return;
      }
      if (activePlayback.currentLevel !== undefined) {
        activePlayback.currentLevel = level;
      }
      // Post the updated currentQuality back to the runtime.
      const currentQuality = activePlayback.currentLevel ?? -1;
      this.lastReportedLevel = currentQuality;
      this.PostStateToRuntime({ currentQuality });
    }

    OnResize() {
      console.log("[video player] Resize requested");
      this.ResizePlayer();
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).Genvidtech_GCoreVideoPlugin_ElementHandler =
    ElementHandler;
}
