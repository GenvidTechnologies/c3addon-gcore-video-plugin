"use strict";

{
	class ElementHandler {
		constructor(element, elementId, domHandler) {
			this.element = element;
			this.elementId = elementId;
			this.handler = domHandler;
			this.gplayerAPI = null;
			this.isInitialized = false;
			this.controller = new AbortController();

			this.Setup();
		}

		Setup() {
			const { signal } = this.controller;
			this.element.addEventListener("error", (e) => this.OnIFrameError(e), {
				signal,
			});
			this.element.addEventListener("load", () => this.OnLoad(), { signal });

			const interactiveEvents = [
				"touchstart",
				"touchmove",
				"touchend",
				"mousedown",
				"mouseup",
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
			this.element.allow = "autoplay; encrypted-media";
		}

		PostToRuntime(event, data) {
			this.handler.PostToRuntimeElement(event, this.elementId, data);
		}

		PostStateToRuntime(state) {
			this.PostToRuntime("state-changed", { state });
		}

		PostErrorToRuntime(category, message) {
			this.PostToRuntime("error", { error: { category, message } });
		}

		OnLoad() {
			if (this.element.src !== "") {
				if (this.gplayerAPI === null) {
					console.log("iframe loaded", this.element.src);
					this.CreatePlayer();
					console.log("Player created", this.gplayerAPI);
				}
			}
		}

		OnIFrameError(e) {
			console.error("GCore IFrame error", e);
			this.PostErrorToRuntime("iframe", `Error loading ${this.element.src}`);
		}

		UpdateState(e) {
			let url = e["url"];
			const language = e["subtitles"] || "off";
			if (url !== "" && language !== "off") {
				url += "?sub_lang=" + language;
			}
			if (this.element.src !== url) {
				let playerState = "offline";
				if (url !== "") {
					console.debug("Loading", url);
					playerState = "loading";
				} else {
					console.debug("Offloading video player");
					this.DestroyPlayer();
				}
				this.element.src = url;
				this.PostStateToRuntime({ playerState });
			}
		}
		CreatePlayer() {
			console.log("Setting up new player");
			if (window.GcorePlayer && window.GcorePlayer.gplayerAPI) {
				// Initialize the player
				this.gplayerAPI = new GcorePlayer.gplayerAPI(this.element);
			} else {
				console.error("[video player] GcorePlayer or gplayerAPI not found");
				throw new Error("GCore Player API not found");
			}

			this.gplayerAPI.on("error", (err) => {
				console.error("VideoPlayer API Error", err);
				this.PostErrorToRuntime("gcore", err);
			});

			this.gplayerAPI.on("play", () => {
				console.log("[video player]", "Playing");

				if (this.isInitialized) {
					this.PostStateToRuntime({
						playerState: "playing",
					});
				} else {
					// Sequence that load the video and ensure the state is ready.
					// Also seems to avoid the fullscreen pop on iOS, sometimes...
					this.OnPause();
					this.GetDuration();
					this.GetVolume();
				}
			});

			this.gplayerAPI.on("pause", () => {
				console.log("[video player]", "Paused");
				this.isInitialized = true;
				this.PostStateToRuntime({
					playerState: "paused",
				});
			});

			this.gplayerAPI.on("timeupdate", (e) => {
				this.PostStateToRuntime({
					currentPlaybackTime: e.current,
				});
			});

			this.gplayerAPI.on("volumeupdate", (e) => {
				console.log("[video player] Volume updated", e);

				this.PostStateToRuntime({
					currentVolume: e,
				});
			});

			this.gplayerAPI.on("ended", () => {
				console.log("[video player]", "Ended");

				this.PostStateToRuntime({
					playerState: "ended",
				});
			});

			this.gplayerAPI.on("ready", () => {
				console.log("[video player]", "Ready");

				this.isInitialized = false;

				// Actually load the video for the first time.
				this.OnPlay();
			});
		}
		DestroyPlayer() {
			if (this.gplayerAPI) {
				this.gplayerAPI.removeAllListeners();
				this.gplayerAPI = null;
			}
		}
		Destroy() {
			// remove event listeners
			this.controller.abort();
			this.element.src = "";
			this.DestroyPlayer();
		}

		OnPlay() {
			console.log("[video player] Play requested");
			this.gplayerAPI.method({ name: "play" });
		}

		OnPause() {
			console.log("[video player] Pause requested");
			this.gplayerAPI.method({ name: "pause" });
		}

		OnSeek(state) {
			console.log("[video player] Seek requested", state.requestedPlaybackTime);
			if (state.requestedPlaybackTime) {
				this.gplayerAPI.method({
					name: "seek",
					params: state.requestedPlaybackTime,
				});
			}
		}

		OnSetVolume(state) {
			console.log("[video player] Set volume requested", state.requestedVolume);
			if (state.requestedVolume) {
				this.gplayerAPI.method({
					name: "setVolume",
					params: state.requestedVolume,
				});
			}
		}

		OnMute() {
			console.log("[video player]", "Mute requested");
			this.gplayerAPI.method({
				name: "mute",
				callback: () => {
					console.log("[video player]", "Muted");

					this.PostStateToRuntime({
						audioState: "muted",
					});
				},
			});
		}

		OnUnmute() {
			console.log("[video player]", "Unmute requested");
			this.gplayerAPI.method({
				name: "unmute",
				callback: () => {
					console.log("[video player]", "Unmuted");

					this.PostStateToRuntime({
						audioState: "unmuted",
					});
				},
			});
		}

		GetDuration() {
			console.log("[video player]", "Current duration requested");
			this.gplayerAPI.method({
				name: "getDuration",
				callback: (res) => {
					console.log("[video player] Duration", res);

					this.PostStateToRuntime({
						duration: res,
					});
				},
			});
		}

		GetVolume() {
			console.log("[video player]", "Current volume requested");
			this.gplayerAPI.method({
				name: "getVolume",
				callback: (res) => {
					console.log("[video player] Current volume", res);

					this.PostStateToRuntime({
						currentVolume: res,
					});
				},
			});
		}
	}

	globalThis.GenvidGCorePlugin_ElementHandler = ElementHandler;

}
