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
	_enableChrome: boolean = true;
	_enableDvr: boolean = false;
	_fallbackUrls: string[] = [];
	_subtitleSources: Array<{ url: string; language: string; label: string }> = [];
	_isInitialized = false;
	_isReady = false;

	_currentPlaybackTime = 0;
	_currentVolume = -1;
	_duration = -1;
	_currentQuality = -1;
	_qualityCount = 0;

	// DVR readout state — per-video; reset in _InitializeState.
	_isDvr: boolean = false;
	_seekableStart: number = 0;
	_seekableEnd: number = -1;

	// Subtitle track list — per-video; reset in _InitializeState.
	_subtitleTracks: Array<{ language: string; label: string }> = [];

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

		if (properties) {
			this._url = (properties[0] ?? "") as string;
			this._subtitles = (properties[1] ?? "off") as string;
			this._noLowLatency = (properties[2] ?? false) as boolean;
			this._enableChrome = (properties[3] ?? true) as boolean;
			this._enableDvr = (properties[4] ?? false) as boolean;
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
			"noLowLatency": this._noLowLatency,
			"enableChrome": this._enableChrome,
			"enableDvr": this._enableDvr,
			"fallbackUrls": this._fallbackUrls,
			"subtitleSources": this._subtitleSources
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
		this._currentQuality = -1;
		this._qualityCount = 0;

		// Reset DVR readout — per-video, like currentQuality.
		this._isDvr = false;
		this._seekableStart = 0;
		this._seekableEnd = -1;

		// Reset subtitle track list — per-video, like currentQuality.
		this._subtitleTracks = [];

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

			if (state.currentQuality !== undefined) {
				this._currentQuality = state.currentQuality as number;
			}

			if (state.qualityCount !== undefined) {
				this._qualityCount = state.qualityCount as number;
			}

			// DVR readout — posted from ElementHandler when the DVR window is known.
			// Use !== undefined so a legitimate false/0 is stored rather than dropped.
			if (state.isDvr !== undefined) {
				this._isDvr = state.isDvr as boolean;
			}

			if (state.seekableStart !== undefined) {
				this._seekableStart = state.seekableStart as number;
			}

			if (state.seekableEnd !== undefined) {
				this._seekableEnd = state.seekableEnd as number;
			}

			// Subtitle track list — only sent by the DOM side when it changed.
			// Fire the dedicated trigger so the game can rebuild its subtitle menu.
			if (state.subtitleTracks !== undefined) {
				this._subtitleTracks = state.subtitleTracks as Array<{ language: string; label: string }>;
				this._trigger(C3.Plugins.Genvidtech_GCoreVideoPlugin.Cnds.OnSubtitlesAvailable);
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

	_SetQuality(level: number) {
		this._postToDOMElement("setQuality", { level });
	}

	_Resize() {
		this._postToDOMElement("resize", null);
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

	_SetURL(url: string, noLowLatency: boolean): Promise<JSONValue> {
		const urlChanged = this._url !== url;
		if (!urlChanged && this._noLowLatency === noLowLatency) {
			// No-op: nothing to load, so the awaitable resolves immediately.
			return Promise.resolve(null);
		}

		// Update the locally stored state, then drive the load over the async DOM
		// bridge. Unlike _updateElementState() (fire-and-forget), the "loadVideo"
		// handler returns a promise that resolves once the player reaches Ready
		// (or settles on error/timeout/supersession), so an event sheet can await
		// Load Video before applying post-load settings (subtitles, seek, quality).
		this._url = url;
		this._noLowLatency = noLowLatency;
		if (urlChanged) {
			// Loading a video starts with a clean subtitle slate: subtitles are no
			// longer a SetURL parameter. Use SetSubtitles / AddSubtitleSource after
			// loading. This also stops the previous video's subtitles (in-manifest
			// selection and side-loaded sources) from leaking onto the new one.
			this._subtitles = "off";
			this._subtitleSources = [];
		}
		return this._postToDOMElementAsync("loadVideo", this._getElementState());
	}

	_GetURL() {
		return this._url;
	}

	_AddSubtitleSource(url: string, language: string, label: string) {
		this._subtitleSources = [...this._subtitleSources, { url, language, label }];
		this._updateElementState();
	}

	async _AddProjectSubtitleSource(file: string, language: string, label: string) {
		// Resolve the project file to a runtime URL, then add it like a normal
		// external subtitle source.
		let url: string;
		try {
			url = await this.runtime.assets.getProjectFileUrl(file);
		} catch (e) {
			console.error("[GCoreVideo] Could not resolve project file", file, e);
			return;
		}
		this._AddSubtitleSource(url, language, label);
	}

	_SetFallbackURLs(urls: string) {
		const parsed = urls.split(/[,\n]/).map(s => s.trim()).filter(Boolean);
		// Only update and trigger a state refresh if the list actually changed.
		if (JSON.stringify(parsed) === JSON.stringify(this._fallbackUrls)) {
			return;
		}
		this._fallbackUrls = parsed;
		this._updateElementState();
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
		// Only default when the arg is actually absent (nullish); an explicit
		// false must be preserved — mirrors the _SetURL handling.
		noLowLatency = noLowLatency ?? false;
		if (this._noLowLatency === noLowLatency)
			return;

		this._noLowLatency = noLowLatency;
		this._updateElementState();
	}

	_GetNoLowLatency() {
		return this._noLowLatency ? 1 : 0;
	}

	_SetEnableChrome(enable?: boolean) {
		// Only default when the arg is actually absent (nullish); an explicit
		// false must be preserved — mirrors the _SetNoLowLatency handling.
		enable = enable ?? false;
		if (this._enableChrome === enable)
			return;

		this._enableChrome = enable;
		this._updateElementState();
	}

	_GetEnableChrome() {
		return this._enableChrome ? 1 : 0;
	}

	_SetEnableDVR(enable?: boolean) {
		// Only default when the arg is actually absent (nullish); an explicit
		// false must be preserved — mirrors the _SetEnableChrome handling.
		enable = enable ?? false;
		if (this._enableDvr === enable)
			return;

		this._enableDvr = enable;
		this._updateElementState();
	}

	_GetEnableDVR() {
		return this._enableDvr ? 1 : 0;
	}

	_GetSeekableStart() {
		return this._seekableStart;
	}

	_GetSeekableEnd() {
		return this._seekableEnd;
	}

	_IsDVR() {
		return this._isDvr;
	}

	_HasSubtitles() {
		return this._subtitleTracks.length > 0;
	}

	_HasSubtitleLanguage(lang: string) {
		const l = (lang ?? "").toLowerCase();
		return this._subtitleTracks.some(t => t.language.toLowerCase() === l);
	}

	_HasSubtitleLabel(label: string) {
		const l = (label ?? "").toLowerCase();
		return this._subtitleTracks.some(t => t.label.toLowerCase() === l);
	}

	_GetSubtitleCount() {
		return this._subtitleTracks.length;
	}

	_GetSubtitleLanguageAt(index: number) {
		return this._subtitleTracks[index]?.language ?? "";
	}

	_GetSubtitleLabelAt(index: number) {
		return this._subtitleTracks[index]?.label ?? "";
	}

	_saveToJson() {
		// TODO: Add more state in it?
		return {
			// data to be saved for savegames
			"url": this._url,
			"subtitles": this._subtitles,
			"noLowLatency": this._noLowLatency,
			"enableChrome": this._enableChrome,
			"enableDvr": this._enableDvr,
			"fallbackUrls": this._fallbackUrls,
			"subtitleSources": this._subtitleSources
		};
	}

	_loadFromJson(o: JSONObject) {
		// load state for savegames
		this._url = (o["url"] ?? "") as string;
		this._subtitles = (o["subtitles"] ?? "off") as string;
		this._noLowLatency = (o["noLowLatency"] ?? false) as boolean;
		this._enableChrome = (o["enableChrome"] ?? true) as boolean;
		this._enableDvr = (o["enableDvr"] ?? false) as boolean;
		this._fallbackUrls = (o["fallbackUrls"] ?? []) as string[];
		this._subtitleSources = (o["subtitleSources"] ?? []) as Array<{ url: string; language: string; label: string }>;

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
					{ name: prefix + "url", value: this._url, onedit: v => this._SetURL(v as string, this._noLowLatency) },
					{ name: prefix + "subtitles", value: this._subtitles, onedit: v => this._SetSubtitles(v as string) },
					{ name: prefix + "noLowLatency", value: this._noLowLatency, onedit: v => this._SetNoLowLatency(v as boolean) },
					{ name: prefix + "enableChrome", value: this._enableChrome, onedit: v => this._SetEnableChrome(v as boolean) },
					{ name: prefix + "enableDvr", value: this._enableDvr, onedit: v => this._SetEnableDVR(v as boolean) },
					{ name: prefix + "fallbackUrls", value: this._fallbackUrls.length },
					{ name: prefix + "subtitleSources", value: this._subtitleSources.length },
					{ name: prefix + "playbackTime", value: this._currentPlaybackTime, onedit: v => this._SetPlaybackTime(v as number) },
					{ name: prefix + "volume", value: this._currentVolume, onedit: v => this._SetVolume(v as number) },
					{ name: prefix + "duration", value: this._duration },
					{ name: prefix + "playerState", value: this._playerState },
					{ name: prefix + "audioState", value: this._audioState },
					{ name: prefix + "lastErrorCategory", value: this._lastError.category as string },
					{ name: prefix + "lastErrorMessage", value: this._lastError.message as string },
					{ name: prefix + "currentQuality", value: this._currentQuality, onedit: v => this._SetQuality(v as number) },
					{ name: prefix + "qualityCount", value: this._qualityCount },
					{ name: prefix + "isDvr", value: this._isDvr },
					{ name: prefix + "seekableStart", value: this._seekableStart },
					{ name: prefix + "seekableEnd", value: this._seekableEnd },
					{ name: prefix + "subtitleTracks", value: this._subtitleTracks.length }
				]
			},
		];
	}
};

C3.Plugins.Genvidtech_GCoreVideoPlugin.Instance = GCoreVideoInstance;

export type { GCoreVideoInstance as SDKInstanceClass };