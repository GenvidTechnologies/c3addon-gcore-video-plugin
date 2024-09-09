const C3 = self.C3;

// NOTE: use a unique DOM component ID to ensure it doesn't clash with anything else.
// This must also match the ID in plugin.js and domSide.js.
const DOM_COMPONENT_ID = "genvidtech-gcorevideoplugin";

C3.Plugins.Genvidtech_GCoreVideoPlugin.Instance = class GCoreVideoInstance extends C3.SDKDOMInstanceBase {
	constructor(inst, properties) {
		super(inst, DOM_COMPONENT_ID);

		this._InitializeState();

		if (properties) {
			this._url = properties[0];
			this._subtitles = properties[1] || "off";
		}

		this.CreateElement();
	}

	Release() {
		this._InitializeState();
		super.Release();
	}

	GetElementState() {
		// Return JSON with the state of the element. This is passed along to both CreateElement()
		// and UpdateState() in domSide.js. It provides a convenient way to send all the DOM element
		// state in one go, ensuring any changes are reflected in the real element.
		return {
			"url": this._url,
			"subtitles": this._subtitles
		};
	}

	// Initialize state when setting up or disposing player
	_InitializeState() {
		this._isLoading = true;
		this._isReady = false;
		this._isPlaying = false;
		this._isPaused = false;
		this._isEnded = false;
		this._isMuted = false;
		this._isInitialized = false;

		this._currentPlaybackTime = 0;
		this._currentVolume = -1;
		this._duration = -1;

		this._playerState = "loading";
		this._audioState = "ready";

	}

	_OnStateChanged(e) {
		if (e.state) {
			switch (e.state.playerState) {
				case "ready": {
					// Assuming that we are loading a new video
					this._InitializeState();

					this._isInitialized = true;

					break;
				}
				case "playing": {
					this._isPlaying = true;
					this._isPaused = false;
					this._isEnded = false;
					this._playerState = "playing";

					break;
				}
				case "paused": {
					this._isPaused = true;
					this._isPlaying = false;
					this._isEnded = false;
					this._playerState = "paused";

					break;
				}
				case "ended": {
					this._isPlaying = false;
					this._isPaused = false;
					this._isEnded = true;
					this._playerState = "ended";

					break;
				}
			}

			// Check if audio state has been updated
			if (e.state.audioState === "muted" && !this._isMuted) {
				this._isMuted = true;
				this._audioState = "muted";
			} else if (e.state.audioState === "unmuted" && this._isMuted) {
				this._isMuted = false;
				this._audioState = "unmuted";
			}

			if (e.state.currentPlaybackTime) {
				this._currentPlaybackTime = e.state.currentPlaybackTime;
			}

			if (e.state.currentVolume) {
				if (e.state.currentVolume === 0) {
					this._isMuted = true;
					this._audioState = "muted";
				} else if (e.state.currentVolume > 0 && this._isMuted) {
					this._isMuted = false;
					this._audioState = "unmuted";
				}
				this._currentVolume = e.state.currentVolume;
			}

			if (e.state.duration) {
				this._duration = e.state.duration;
			}

			// Finally mark the player as ready when current volume and duration values have been retrieved
			if (!this._isReady && this._currentVolume > -1 && this._duration > -1) {
				this._isLoading = false;
				this._isReady = true;
				this._playerState = "ready";
			}
		}

		this._SetState({
			playerState: this._playerState,
			audioState: this._audioState,
			currentVolume: this._currentVolume,
			duration: this._duration,
			currentPlaybackTime: this._currentPlaybackTime
		});

		this.Trigger(C3.Plugins.Genvidtech_GCoreVideoPlugin.Cnds.OnStateChanged);
	}

	Draw(renderer) {
		// not used - a DOM element is positioned at this instance instead
	}

	_Play() {
		this.PostToDOMElement("play");
	}

	_Pause() {
		this.PostToDOMElement("pause");
	}

	_SetPlaybackTime(playbackTime) {
		const state = this._GetState();
		state.requestedPlaybackTime = playbackTime;
		this._SetState(state);

		this.PostToDOMElement("seek", this._GetState());
	}

	_SetVolume(level) {
		const state = this._GetState();
		state.requestedVolume = level;
		this._SetState(state);

		this.PostToDOMElement("setVolume", this._GetState());
	}

	_SetMuted(mute) {
		if (mute) {
			this.PostToDOMElement("mute");
		} else {
			this.PostToDOMElement("unmute");
		}
	}

	_SetState(state) {
		// Update the local video player state
		this._state = state;
	}

	_GetState() {
		return this._state;
	}

	_SetURL(url) {
		if (this._url === url)
			return;						// no change

		// Update the locally stored text, and call UpdateElementState().
		// This calls GetElementState() - which contains the button text as part of the state -
		// and then calls UpdateState() in domSide.js with the state object, where the button text
		// is applied to the DOM element.
		this._url = url;
		this.UpdateElementState();
	}

	_GetURL() {
		return this._url;
	}

	_SetSubtitles(language) {
		language = language || "off";
		if (this._subtitles === language)
			return;

		this._subtitles = language;
		this.UpdateElementState();
	}

	_GetSubtitles() {
		return this._subtitles;
	}



	SaveToJson() {
		// TODO: Add more state in it?
		return {
			// data to be saved for savegames
			"url": this._url,
			"subtitles": this._subtitles
		};
	}

	LoadFromJson(o) {
		// load state for savegames
		this._url = o["url"];
		this._subtitles = o["subtitles"] || "off";

		this.UpdateElementState();		// ensures any state changes are updated in the DOM
	}

	GetScriptInterfaceClass() {
		return self.IGCoreVideoInstance;
	}
};

// Script interface. Use a WeakMap to safely hide the internal implementation details from the
// caller using the script interface.
const map = new WeakMap();

self.IGCoreVideoInstance = class IGCoreVideoInstance extends self.IDOMInstance {
	constructor() {
		super();

		// Map by SDK instance
		map.set(this, self.IInstance._GetInitInst().GetSdkInstance());
	}

	// Example setter/getter property on script interface
	set url(u) {
		map.get(this)._SetURL(u);
	}

	get url() {
		return map.get(this)._GetURL();
	}

	set subtitles(s) {
		map.get(this)._SetSubtitles(s);
	}

	get subtitles() {
		return map.get(this)._GetSubtitles();
	}
};
