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
				this.element.addEventListener(e, StopPropagation, { signal })
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

		OnLoad() {
			console.log("iframe loaded", this.element.src);
			if (this.gplayerAPI === null) {
				this.CreatePlayer();
				console.log("Player created", this.gplayerAPI);
			}
		}
		UpdateState(e, isNew) {
			let url = e["url"];
			const language = e["subtitles"] || "off";
			if (language !== "off") {
				url += "?sub_lang=" + language;
			}
			if (this.element.src != url) {
				console.debug("Loading", url);
				this.element.src = url;
				if (!isNew) {
					this.PostStateToRuntime({ playerState: "loading" });
				}
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
				// TODO: Send it to runtime and add a trigger/conditions.
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
				this.PostStateToRuntime({
					playerState: "ready",
				});

				// Actually load the video for the first time.
				this.OnPlay();
			});
		}
		Destroy() {
			this.element.removeEventListener("load", this._OnLoadListener);
			this.element.src = "";
			if (this.gplayerAPI) {
				this.gplayerAPI.removeAllListeners();
				this.gplayerAPI = null;
			}
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

	class ElementHandlerMap {
		constructor(domHandler) {
			this._map = new Map();
			this._dom = domHandler;
		}
		Set(element, handler) {
			let id = element.id ?? "";
			if (id !== "") {
				console.error({ error: "Element already have an id", element });
				throw new Error("Element already initialized!");
			}
			id = `gcore_${handler.elementId}`;
			if (this._map.has(id)) {
				console.error({ error: "Handler already exists", id });
				throw new Error("Handler already exists");
			}
			element.id = id;
			this._map.set(id, handler);
			return handler;
		}

		Get(element) {
			const id = element.id;
			if (!id) {
				console.error({ error: "No element Id on element", element });
				throw new Error("No element identifier");
			}
			if (!this._map.has(id)) {
				console.error({ error: "No handler with that id", id });
				throw new Error("Handler does not exist");
			}
			return this._map.get(id);
		}

		Delete(element) {
			const handler = this.Get(element);
			this._map.delete(element.id);
			return handler;
		}
	}

	const HANDLER_CLASS = class GCoreVideoDOMHandler extends self.DOMElementHandler {
		constructor(iRuntime) {
			super(iRuntime, DOM_COMPONENT_ID);
			this._handlers = new ElementHandlerMap();
			[
				["play", (elem, e) => this._handlers.Get(elem).OnPlay()],
				["pause", (elem, e) => this._handlers.Get(elem).OnPause()],
				["mute", (elem, e) => this._handlers.Get(elem).OnMute()],
				["unmute", (elem, e) => this._handlers.Get(elem).OnUnmute()],
				["seek", (elem, e) => this._handlers.Get(elem).OnSeek(e)],
				["setVolume", (elem, e) => this._handlers.Get(elem).OnSetVolume(e)],
			].map(([e, h]) => this.AddDOMElementMessageHandler(e, h));
		}

		CreateElement(elementId, e) {
			const element = document.createElement("iframe");
			const handler = new ElementHandler(element, elementId, this);
			this._handlers.Set(element, handler);

			// The create message includes the state retrieved by GetElementState() in instance.js,
			// so also update the element state based on those details.
			handler.UpdateState(e, true);

			console.log("IFrame created:", element);

			return element;
		}

		DestroyElement(element) {
			const handler = this._handlers.Delete(element);
			handler.Destroy();
			super.DestroyElement(element);
		}

		UpdateState(elem, e) {
			// Update the state of the DOM element 'elem' with the state 'e'. The state has been
			// retrieved by calling GetElementState() in instance.js, which includes all necessary
			// details to set the correct state of the DOM element.
			// NOTE: the runtime automatically manages the position, size and visibility of the DOM
			// element, so this only needs to handle state unique to the element, such as the button
			// text in this case.
			this._handlers.Get(elem).UpdateState(e, false);
		}
	};

	self.RuntimeInterface.AddDOMHandlerClass(HANDLER_CLASS);
}
