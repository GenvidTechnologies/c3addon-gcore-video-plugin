"use strict";

{
	// In the C3 runtime's worker mode, all the runtime scripts (e.g. plugin.js, instance.js, actions.js)
	// are loaded in a Web Worker, which has no access to the document so cannot make DOM calls. To help
	// plugins use DOM elements the runtime internally manages a postMessage() bridge wrapped in some helper
	// classes designed to manage DOM elements. Then this script (domSide.js) is loaded in the main document
	// (aka the main thread) where it can make any DOM calls on behalf of the runtime. Conceptually the two
	// ends of the messaging bridge are the "Runtime side" in a Web Worker, and the "DOM side" with access
	// to the Document Object Model (DOM). The addon's plugin.js specifies to load this script on the
	// DOM side by making the call: this._info.SetDOMSideScripts(["c3runtime/domSide.js"])
	// Note that when NOT in worker mode, this entire framework is still used identically, just with both
	// the runtime and the DOM side in the main thread. This allows non-worker mode to work the same with
	// no additional code changes necessary. However it's best to imagine that the runtime side is in a
	// Web Worker, since that is when it is necessary to separate DOM calls from the runtime.

	// NOTE: use a unique DOM component ID to ensure it doesn't clash with anything else
	// This must also match the ID in instance.js and plugin.js.
	const DOM_COMPONENT_ID = "genvidtech-gcorevideoplugin";

	const HANDLER_CLASS = class GCoreVideoDOMHandler extends self.DOMHandler {
		constructor(iRuntime) {
			super(iRuntime, DOM_COMPONENT_ID);

			this._initialized = false;

			this.AddRuntimeMessageHandlers([
				["load", e => this._OnLoad(e)],
				["play", e => this._OnPlay()],
				["pause", e => this._OnPause()],
				["mute", e => this._OnMute()],
				["unmute", e => this._OnUnmute()],
				["getDuration", e => this._OnGetDuration()],
				["getVolume", e => this._OnGetVolume()],
				["seek", e => this._OnSeek(e)],
				["setVolume", e => this._OnSetVolume(e)],
				["dispose", e => this._OnDispose()]
			]);
		}

		_OnLoad(iframeId) {
			this.iframeElement = document.getElementById(iframeId);
			if (this.iframeElement) {
				if (window.GcorePlayer && window.GcorePlayer.gplayerAPI) {
					// Initialize the player
					this.gplayerAPI = new GcorePlayer.gplayerAPI(this.iframeElement);
				} else {
					console.error("[video player] GcorePlayer or gplayerAPI not found");
				}

				this.gplayerAPI.on("play", () => {
					console.log("[video player]", "Playing");

					if (this._initialized) {
						this.PostToRuntime("state-changed", {
							state: {
								playerState: "playing",
							}
						});
					} else {
						this._OnPause();
						this._OnGetDuration();
						this._OnGetVolume();
					}
				});

				this.gplayerAPI.on("pause", () => {
					console.log("[video player]", "Paused");
					this._initialized = true;
					this.PostToRuntime("state-changed", {
						state: {
							playerState: "paused",
						}
					});
				});

				this.gplayerAPI.on("timeupdate", (e) => {
					this.PostToRuntime("state-changed", {
						state: {
							currentPlaybackTime: e.current,
						}
					});
				});

				this.gplayerAPI.on("volumeupdate", (e) => {
					console.log("[video player] Volume updated", e);

					this.PostToRuntime("state-changed", {
						state: {
							currentVolume: e,
						}
					});
				});

				this.gplayerAPI.on("ended", () => {
					console.log("[video player]", "Ended");

					this.PostToRuntime("state-changed", {
						state: {
							playerState: "ended",
						}
					});
				});

				this.gplayerAPI.on("ready", () => {
					console.log("[video player]", "Ready");

					this._initialized = false;
					this.PostToRuntime("state-changed", {
						state: {
							playerState: "ready",
						}
					});

					// Actually load the video for the first time.
					this._OnPlay();

				});



			} else {
				console.error("[video player] Iframe element not found");
			}
		}

		UpdateState(elem, e) {
		}

		_OnPlay() {
			this.gplayerAPI.method({ name: "play" });
		}

		_OnPause() {
			this.gplayerAPI.method({ name: "pause" });
		}

		_OnSeek(state) {
			console.log("[video player] Seek requested", state.requestedPlaybackTime);
			if (state.requestedPlaybackTime) {
				this.gplayerAPI.method({
					name: "seek",
					params: state.requestedPlaybackTime
				});
			}
		}

		_OnSetVolume(state) {
			console.log("[video player] Set volume requested", state.requestedVolume);
			if (state.requestedVolume) {
				this.gplayerAPI.method({
					name: "setVolume",
					params: state.requestedVolume
				});
			}
		}

		_OnMute() {
			console.log("[video player]", "Mute requested");
			this.gplayerAPI.method({
				name: "mute", callback: () => {
					console.log("[video player]", "Muted");

					this.PostToRuntime("state-changed", {
						state: {
							audioState: "muted",
						}
					});
				}
			});
		}

		_OnUnmute() {
			console.log("[video player]", "Unmute requested");
			this.gplayerAPI.method({
				name: "unmute", callback: () => {
					console.log("[video player]", "Unmuted");

					this.PostToRuntime("state-changed", {
						state: {
							audioState: "unmuted",
						}
					});
				}
			});
		}

		_OnGetDuration() {
			console.log("[video player]", "Current duration requested");
			this.gplayerAPI.method({
				name: "getDuration", callback: (res) => {
					console.log("[video player] Duration", res);

					this.PostToRuntime("state-changed", {
						state: {
							duration: res,
						}
					});
				}
			});
		}

		_OnGetVolume() {
			console.log("[video player]", "Current volume requested");
			this.gplayerAPI.method({
				name: "getVolume", callback: (res) => {
					console.log("[video player] Current volume", res);

					this.PostToRuntime("state-changed", {
						state: {
							currentVolume: res,
						}
					});

				}
			});
		}

		_OnDispose() {
			window.removeEventListener("message", this.handleGcoreMethodMessages.bind(this));
			this.gplayerAPI = null;
		}
	};

	self.RuntimeInterface.AddDOMHandlerClass(HANDLER_CLASS);
}