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

	function StopPropagation(e) {
		e.stopPropagation();
	}

	const HANDLER_CLASS = class GCoreVideoDOMHandler extends self.DOMElementHandler {
		constructor(iRuntime) {
			super(iRuntime, DOM_COMPONENT_ID);

			this._initialized = false;
			this.gplayerAPI = null;

			this.AddRuntimeMessageHandlers([
				["play", e => this._OnPlay()],
				["pause", e => this._OnPause()],
				["mute", e => this._OnMute()],
				["unmute", e => this._OnUnmute()],
				["seek", e => this._OnSeek(e)],
				["setVolume", e => this._OnSetVolume(e)],
				["dispose", e => this._OnDispose()]
			]);
		}

		CreateElement(elementId, e) {
			this._elementId = elementId;
			const elem = document.createElement("iframe");
			elem.style.position = "absolute";
			elem.style.border = "none";
			elem.style.pointerEvents = "none";
			elem.allow = "autoplay; encrypted-media"

			// Prevent touches reaching the canvas
			elem.addEventListener("touchstart", StopPropagation);
			elem.addEventListener("touchmove", StopPropagation);
			elem.addEventListener("touchend", StopPropagation);

			// Prevent clicks being blocked
			elem.addEventListener("mousedown", StopPropagation);
			elem.addEventListener("mouseup", StopPropagation);

			// Prevent key presses being blocked by the Keyboard object
			elem.addEventListener("keydown", StopPropagation);
			elem.addEventListener("keyup", StopPropagation);

			elem.addEventListener("click", StopPropagation);

			elem.addEventListener("load", () => {
				console.log("iframe loaded", elem.src);
				if (this.gplayerAPI === null) {
					this._CreatePlayer(elem);
					console.log("Player created", this.gplayerAPI);	
				}
			});

			// The create message includes the state retrieved by GetElementState() in instance.js,
			// so also update the element state based on those details.
			this.UpdateState(elem, e, true);


			console.log("IFrame created:", elem);

			return elem;
		}

		UpdateState(elem, e, isNew = false) {
			// Update the state of the DOM element 'elem' with the state 'e'. The state has been
			// retrieved by calling GetElementState() in instance.js, which includes all necessary
			// details to set the correct state of the DOM element.
			// NOTE: the runtime automatically manages the position, size and visibility of the DOM
			// element, so this only needs to handle state unique to the element, such as the button
			// text in this case.
			let url = e["url"];
			const language = e["subtitles"] || "off";
			if (language !== "off") {
				url += "?sub_lang=" + language;
			}
			if (elem.src != url) {
				console.debug("Loading", url);
				elem.src = url;
				if (!isNew) {
					this._PostStateToRuntime({playerState: "loading"});
				}
			}
		}

		_PostStateToRuntime(state) {
			this.PostToRuntimeElement("state-changed", this._elementId, { state });
		}


		_CreatePlayer(elem) {

			console.log("Setting up new player");
			if (window.GcorePlayer && window.GcorePlayer.gplayerAPI) {
				// Initialize the player
				this.gplayerAPI = new GcorePlayer.gplayerAPI(elem);
			} else {
				console.error("[video player] GcorePlayer or gplayerAPI not found");
				throw new Error("GCore Player API not found");
			}

			this.gplayerAPI.on('error', (err) => {
				console.error("VideoPlayer API Error", err);
				// TODO: Send it to runtime and add a trigger/conditions.			
			});

			this.gplayerAPI.on("play", () => {
				console.log("[video player]", "Playing");

				if (this._initialized) {
					this._PostStateToRuntime({
						playerState: "playing"
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
				this._PostStateToRuntime({
					playerState: "paused"
				});
			});

			this.gplayerAPI.on("timeupdate", (e) => {
				this._PostStateToRuntime({

					currentPlaybackTime: e.current
				});
			});

			this.gplayerAPI.on("volumeupdate", (e) => {
				console.log("[video player] Volume updated", e);

				this._PostStateToRuntime({
					currentVolume: e,
				});
			});

			this.gplayerAPI.on("ended", () => {
				console.log("[video player]", "Ended");

				this._PostStateToRuntime({
					state: {
						playerState: "ended",
					}
				});
			});

			this.gplayerAPI.on("ready", () => {
				console.log("[video player]", "Ready");

				this._initialized = false;
				this._PostStateToRuntime({
					playerState: "ready",
				});

				// Actually load the video for the first time.
				this._OnPlay();
			});
		}

		_OnPlay() {
			console.log("[video player] Play requested");
			this.gplayerAPI.method({ name: "play" });
		}

		_OnPause() {
			console.log("[video player] Pause requested");
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

					this._PostStateToRuntime({
						audioState: "muted",
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
						audioState: "unmuted",
					});
				}
			});
		}

		_OnGetDuration() {
			console.log("[video player]", "Current duration requested");
			this.gplayerAPI.method({
				name: "getDuration", callback: (res) => {
					console.log("[video player] Duration", res);

					this._PostStateToRuntime({
						duration: res,
					});
				}
			});
		}

		_OnGetVolume() {
			console.log("[video player]", "Current volume requested");
			this.gplayerAPI.method({
				name: "getVolume", callback: (res) => {
					console.log("[video player] Current volume", res);

					this._PostStateToRuntime({
						currentVolume: res,
					});

				}
			});
		}

		_OnDispose() {
			this.gplayerAPI = null;
		}
	};

	self.RuntimeInterface.AddDOMHandlerClass(HANDLER_CLASS);
}