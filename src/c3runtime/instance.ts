const C3 = globalThis.C3;

// NOTE: use a unique DOM component ID to ensure it doesn't clash with anything else.
// This must also match the ID in plugin.js and domSide.js.
const DOM_COMPONENT_ID = "genvidtech-gcorevideoplugin";

type DebuggerProperties = { 
	title: string; 
	properties: { 
		name: string; 
		value: string|number|boolean,
		onedit?: (v: string|number|boolean) => void;
	}[];
}[];

class GCoreVideoInstance extends globalThis.ISDKDOMInstanceBase {
	
	_url: string = "";
	_subtitles: string = "";
	_noLowLatency: boolean = false;
	_isInitialized = false;
	_isReady = false;

	_currentPlaybackTime = 0;
	_currentVolume = -1;
	_duration = -1;

	_playerState = "offline";
	_audioState = "offline";

	_lastError = {
		category: "",
		message: ""
	};

	constructor() {
		super({ domComponentId: DOM_COMPONENT_ID });

		this._InitializeState();

		const properties = this._getInitProperties();

		console.log('debug properties', properties)
		if (properties) {
			this._url = (properties[0] ?? "") as string;
			this._subtitles = (properties[1] ?? "off") as string;
			this._noLowLatency = (properties[2] ?? false) as boolean;
		}

		this._createElement();
	}

	_release() {
		this._InitializeState();
		super._release();
	}

	_getElementState() {
		// Return JSON with the state of the element. This is passed along to both CreateElement()
		// and UpdateState() in domSide.js. It provides a convenient way to send all the DOM element
		// state in one go, ensuring any changes are reflected in the real element.
		return {
			"url": this._url,
			"subtitles": this._subtitles,
			"noLowLatency": this._noLowLatency
		};
	}

	// Reset per-video state when (re)loading or unloading a video. Does NOT clear
	// _isInitialized: that tracks whether the player API has loaded, which
	// persists across video changes.
	_InitializeState() {
		this._isReady = false;

		this._currentPlaybackTime = 0;
		this._currentVolume = -1;
		this._duration = -1;

		this._playerState = "offline";
		this._audioState = "offline";

		this._lastError = {
			category: "",
			message: ""
		};
	}

	_OnStateChanged(e: JSONObject) {
		if (e.state) {
			const state = e.state as JSONObject;

			// The player API (module) has finished loading.
			if (state.apiInitialized) {
				this._isInitialized = true;
			}

			if (state.playerState) {
				switch (state.playerState) {
					case "loading":
					case "offline": {
						this._InitializeState();
						break;
					}
				}
				this._playerState = state.playerState as string;
			}

			// Check if audio state has been updated
			if (state.audioState) {
				this._audioState = state.audioState as string;
			}

			// Use !== undefined (not truthiness) so a legitimate 0 — a muted
			// volume, a zero duration/playback time — is stored rather than
			// dropped. Dropping a muted volume of 0 was preventing the player
			// from ever reaching its "initialized" (ready) state.
			if (state.currentPlaybackTime !== undefined) {
				this._currentPlaybackTime = state.currentPlaybackTime as number;
			}

			if (state.currentVolume !== undefined) {
				const currentVolume = state.currentVolume as number;
				if (currentVolume === 0) {
					this._audioState = "muted";
				} else if (currentVolume > 0) {
					this._audioState = "unmuted";
				}
				this._currentVolume = currentVolume;
			}

			if (state.duration !== undefined) {
				this._duration = state.duration as number;
			}

			// Mark the video as ready (loaded and playable) once its volume and
			// duration are known.
			if (!this._isReady && this._currentVolume > -1 && this._duration > -1) {
				this._isReady = true;
			}
		}

		this._trigger(C3.Plugins.Genvidtech_GCoreVideoPlugin.Cnds.OnStateChanged);
	}

	_OnError(e: JSONValue) {
		this._lastError = (e as JSONObject).error as typeof this._lastError;
		this._trigger(C3.Plugins.Genvidtech_GCoreVideoPlugin.Cnds.OnError);
	}

	_GetLastError() {
		return this._lastError;
	}

	_Play() {
		this._postToDOMElement("play", null);
	}

	_Pause() {
		this._postToDOMElement("pause", null);
	}

	_SetPlaybackTime(playbackTime: number) {
		this._postToDOMElement("seek", { requestedPlaybackTime: playbackTime });
	}

	_SetVolume(level: number) {
		this._postToDOMElement("setVolume", { requestedVolume: level });
	}

	_SetMuted(mute: boolean) {
		if (mute) {
			this._postToDOMElement("mute", null);
		} else {
			this._postToDOMElement("unmute", null);
		}
	}

	_GetState() {
		return {
			playerState: this._playerState,
			audioState: this._audioState,
			currentVolume: this._currentVolume,
			duration: this._duration,
			currentPlaybackTime: this._currentPlaybackTime,
		};
	}

	_SetURL(url: string, subtitles: string, noLowLatency: boolean) {
		if (subtitles === "") {
			subtitles = this._subtitles
		}
		if (!noLowLatency) {
			noLowLatency = this._noLowLatency
		}
		if (this._url === url && this._subtitles === subtitles && this._noLowLatency === noLowLatency) {
			return;
		}

		// Update the locally stored text, and call UpdateElementState().
		// This calls GetElementState() - which contains the button text as part of the state -
		// and then calls UpdateState() in domSide.js with the state object, where the button text
		// is applied to the DOM element.
		this._url = url;
		this._subtitles = subtitles;
		this._noLowLatency = noLowLatency;
		this._updateElementState();
	}

	_GetURL() {
		return this._url;
	}

	_SetSubtitles(language?: string) {
		language = language || "off";
		if (this._subtitles === language)
			return;

		this._subtitles = language;
		this._updateElementState();
	}

	_GetSubtitles() {
		return this._subtitles;
	}

	_SetNoLowLatency(noLowLatency?: boolean) {
		noLowLatency = noLowLatency || false;
		if (this._noLowLatency === noLowLatency)
			return;

		this._noLowLatency = noLowLatency;
		this._updateElementState();
	}

	_GetNoLowLatency() {
		return this._noLowLatency ? 1 : 0;
	}

	_saveToJson() {
		// TODO: Add more state in it?
		return {
			// data to be saved for savegames
			"url": this._url,
			"subtitles": this._subtitles,
			"noLowLatency": this._noLowLatency
		};
	}

	_loadFromJson(o: JSONObject) {
		// load state for savegames
		this._url = (o["url"] ?? "") as string;
		this._subtitles = (o["subtitles"] ?? "off") as string;
		this._noLowLatency = (o["noLowLatency"] ?? false) as boolean;

		this._updateElementState();		// ensures any state changes are updated in the DOM
	}

	_getDebuggerProperties(): DebuggerProperties {
		const prefix = "plugins.genvidtech_gcorevideoplugin.debugger.";
		return [
			{
				title: prefix + "title",
				properties: [
					{ name: prefix + "isInitialized", value: this._isInitialized },
					{ name: prefix + "isReady", value: this._isReady },
					{ name: prefix + "url", value: this._url, onedit: v => this._SetURL(v as string, this._subtitles, this._noLowLatency) },
					{ name: prefix + "subtitles", value: this._subtitles, onedit: v => this._SetSubtitles(v as string) },
					{ name: prefix + "noLowLatency", value: this._noLowLatency, onedit: v => this._SetNoLowLatency(v as boolean) },
					{ name: prefix + "playbackTime", value: this._currentPlaybackTime, onedit: v => this._SetPlaybackTime(v as number) },
					{ name: prefix + "volume", value: this._currentVolume, onedit: v => this._SetVolume(v as number) },
					{ name: prefix + "duration", value: this._duration },
					{ name: prefix + "playerState", value: this._playerState },
					{ name: prefix + "audioState", value: this._audioState },
					{ name: prefix + "lastErrorCategory", value: this._lastError.category as string },
					{ name: prefix + "lastErrorMessage", value: this._lastError.message as string }
				]
			},
		];
	}
};

C3.Plugins.Genvidtech_GCoreVideoPlugin.Instance = GCoreVideoInstance;

export type { GCoreVideoInstance as SDKInstanceClass };