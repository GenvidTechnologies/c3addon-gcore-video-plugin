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
	const DOM_COMPONENT_ID = "genvidtech-videoplayerplugin2";

	function StopPropagation(e)
	{
		e.stopPropagation();
	}

	const HANDLER_CLASS = class MyDOMHandler extends self.DOMHandler
	{
		constructor(iRuntime)
		{
			super(iRuntime, DOM_COMPONENT_ID);

			this.AddRuntimeMessageHandlers([
				["play", e => this._OnPlay()],
				["pause", e => this._OnPause()],
				["load", e => this._OnLoad()]
			]);

			// this.AddRuntimeMessageHandlers("dispose", () =>
			// 	this._OnDispose()
			// );
		}

		_OnLoad() {
			this.iframeElement = document.getElementById("gplayer");
			console.log("debug iframe 1", this.iframeElement.contentWindow.postMessage)
			if (this.iframeElement) {
				const scriptUrl = "https://vplatform.gvideo.co/_players/latest/gplayerAPI.min.js";
				const existingScript = document.querySelector(`script[src="${scriptUrl}"]`);
				if (existingScript) {
					document.body.removeChild(existingScript);
				}
	
				const script = document.createElement("script");
				script.src = scriptUrl;
				
				// Define what should happen once the script loads
				script.onload = () => {
					// Check if the library loaded correctly
					if (window.GcorePlayer && window.GcorePlayer.gplayerAPI) {
						// Initialize the player
						this.gplayerAPI = new GcorePlayer.gplayerAPI(this.iframeElement);
					} else {
						console.error("[video player] GcorePlayer or gplayerAPI not found");
					}

					this.gplayerAPI.on('ready', () => {
						console.log('[video player]', 'Ready')
					})

					this.gplayerAPI.on('play', () => {
						console.log('[video player]', 'Playing')

						this.PostToRuntime("state-changed", {
							state: {
							  playerState: "playing",
							}
						  });
					})

					this.gplayerAPI.on('timeupdate', (e) => {
						console.log('[video player] timeupdate', e)
					})

					this.gplayerAPI.on('pause', () => {
						console.log('[video player]', 'Paused')

						this.PostToRuntime("state-changed", {
							state: {
							  playerState: "paused",
							}
						  });
					})
				};

				// Append the script to the document body to initiate loading
				document.body.appendChild(script);
			} else {
				console.error("[video player] Iframe element not found");
			}
		}

		UpdateState(elem, e)
		{
		}

		_OnPlay() {
			this.gplayerAPI.method({ name: "play" });
		}

		_OnPause() {
			this.gplayerAPI.method({ name: "pause" });
		}

		// _OnDispose() {
		// 	this.gplayerAPI = null;
		// }
	};
	
	self.RuntimeInterface.AddDOMHandlerClass(HANDLER_CLASS);
}